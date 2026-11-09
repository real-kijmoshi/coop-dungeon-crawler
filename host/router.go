package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/url"
	"sync"
	"time"

	"github.com/huin/goupnp/dcps/internetgateway1"
	"github.com/huin/goupnp/dcps/internetgateway2"
	"github.com/huin/goupnp/soap"
	natpmp "github.com/jackpal/go-nat-pmp"
	netroute "github.com/libp2p/go-netroute"
)

const mappingLease = 10 * time.Minute

type portMapping struct {
	kind         string
	externalIP   net.IP
	externalPort int
	lease        time.Duration
	renew        func(context.Context) error
	remove       func(context.Context) error
}

type upnpAPI interface {
	GetExternalIPAddressCtx(context.Context) (string, error)
	GetSpecificPortMappingEntryCtx(context.Context, string, uint16, string) (uint16, string, bool, string, uint32, error)
	AddPortMappingCtx(context.Context, string, uint16, string, uint16, string, bool, string, uint32) error
	DeletePortMappingCtx(context.Context, string, uint16, string) error
}
type upnpCandidate struct {
	api    upnpAPI
	target *url.URL
}

func discoverUPnP(ctx context.Context) []upnpCandidate {
	candidates := make(chan upnpCandidate, 16)
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		clients, _, _ := internetgateway1.NewWANIPConnection1ClientsCtx(ctx)
		for _, c := range clients {
			select {
			case candidates <- upnpCandidate{c, &c.SOAPClient.EndpointURL}:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		defer wg.Done()
		clients, _, _ := internetgateway1.NewWANPPPConnection1ClientsCtx(ctx)
		for _, c := range clients {
			select {
			case candidates <- upnpCandidate{c, &c.SOAPClient.EndpointURL}:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() {
		defer wg.Done()
		clients, _, _ := internetgateway2.NewWANIPConnection2ClientsCtx(ctx)
		for _, c := range clients {
			select {
			case candidates <- upnpCandidate{c, &c.SOAPClient.EndpointURL}:
			case <-ctx.Done():
				return
			}
		}
	}()
	go func() { wg.Wait(); close(candidates) }()
	var result []upnpCandidate
	for {
		select {
		case c, ok := <-candidates:
			if !ok {
				return result
			}
			result = append(result, c)
		case <-ctx.Done():
			return result
		}
	}
}

func localIPFor(target *url.URL) (net.IP, error) {
	host := target.Hostname()
	if host == "" {
		return nil, errors.New("router has no control address")
	}
	connection, err := net.Dial("udp4", net.JoinHostPort(host, "1900"))
	if err != nil {
		return nil, err
	}
	defer connection.Close()
	return connection.LocalAddr().(*net.UDPAddr).IP, nil
}

func mapUPnP(ctx context.Context, c upnpCandidate, localIP net.IP, internalPort, preferredPort int, description string) (*portMapping, error) {
	ipText, err := c.api.GetExternalIPAddressCtx(ctx)
	if err != nil {
		return nil, err
	}
	externalIP := net.ParseIP(ipText)
	if externalIP == nil {
		return nil, errors.New("router returned an invalid IP address")
	}
	for attempt := 0; attempt < 4; attempt++ {
		externalPort := preferredPort
		if attempt > 0 {
			n, err := rand.Int(rand.Reader, big.NewInt(40000))
			if err != nil {
				return nil, err
			}
			externalPort = 20000 + int(n.Int64())
		}
		oldPort, oldIP, _, oldDescription, _, existingErr := c.api.GetSpecificPortMappingEntryCtx(ctx, "", uint16(externalPort), "TCP")
		if existingErr == nil {
			// Reclaim our own finite lease after an abrupt close, never another app's.
			if int(oldPort) != internalPort || oldIP != localIP.String() || oldDescription != description {
				continue
			}
		} else {
			var fault *soap.SOAPFaultError
			if !errors.As(existingErr, &fault) || fault.Detail.UPnPError.Errorcode != 714 {
				return nil, fmt.Errorf("could not confirm that router port is free: %w", existingErr)
			}
		}
		if err = c.api.AddPortMappingCtx(ctx, "", uint16(externalPort), "TCP", uint16(internalPort), localIP.String(), true, description, uint32(mappingLease/time.Second)); err != nil {
			continue
		}
		m := &portMapping{kind: "UPnP", externalIP: externalIP, externalPort: externalPort, lease: mappingLease}
		owned := func(checkCtx context.Context) error {
			p, ip, _, desc, _, err := c.api.GetSpecificPortMappingEntryCtx(checkCtx, "", uint16(externalPort), "TCP")
			if err != nil {
				return err
			}
			if int(p) != internalPort || ip != localIP.String() || desc != description {
				return errors.New("router mapping ownership changed")
			}
			return nil
		}
		m.renew = func(ctx context.Context) error {
			if err := owned(ctx); err != nil {
				return err
			}
			return c.api.AddPortMappingCtx(ctx, "", uint16(externalPort), "TCP", uint16(internalPort), localIP.String(), true, description, uint32(mappingLease/time.Second))
		}
		m.remove = func(ctx context.Context) error {
			if err := owned(ctx); err != nil {
				return err
			}
			return c.api.DeletePortMappingCtx(ctx, "", uint16(externalPort), "TCP")
		}
		return m, nil
	}
	if err == nil {
		return nil, errors.New("UPnP candidate ports are already mapped")
	}
	return nil, fmt.Errorf("UPnP router did not grant an available finite-lease TCP mapping: %w", err)
}

type pmpAPI interface {
	GetExternalAddress() (*natpmp.GetExternalAddressResult, error)
	AddPortMapping(string, int, int, int) (*natpmp.AddPortMappingResult, error)
}

func mapPMP(client pmpAPI, internalPort, externalPort int) (*portMapping, error) {
	address, err := client.GetExternalAddress()
	if err != nil {
		return nil, err
	}
	result, err := client.AddPortMapping("tcp", internalPort, externalPort, int(mappingLease/time.Second))
	if err != nil {
		return nil, err
	}
	if result.MappedExternalPort == 0 || result.PortMappingLifetimeInSeconds == 0 {
		return nil, errors.New("NAT-PMP did not grant a port and finite lease")
	}
	actual := int(result.MappedExternalPort)
	a := address.ExternalIPAddress
	m := &portMapping{kind: "NAT-PMP", externalIP: net.IPv4(a[0], a[1], a[2], a[3]), externalPort: actual, lease: time.Duration(result.PortMappingLifetimeInSeconds) * time.Second}
	m.renew = func(context.Context) error {
		result, err := client.AddPortMapping("tcp", internalPort, actual, int(mappingLease/time.Second))
		if err != nil {
			return err
		}
		if int(result.MappedExternalPort) != actual {
			return errors.New("NAT-PMP router changed the public port")
		}
		return nil
	}
	m.remove = func(context.Context) error { _, err := client.AddPortMapping("tcp", internalPort, 0, 0); return err }
	return m, nil
}

func openRouterPort(ctx context.Context, internalPort, externalPort int, description string) (*portMapping, error) {
	discoverCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	candidates := discoverUPnP(discoverCtx)
	cancel()
	for _, candidate := range candidates {
		if ctx.Err() != nil {
			break
		}
		localIP, err := localIPFor(candidate.target)
		if err != nil {
			continue
		}
		attemptCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		m, err := mapUPnP(attemptCtx, candidate, localIP, internalPort, externalPort, description)
		cancel()
		if err == nil {
			return m, nil
		}
	}
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	router, err := netroute.New()
	if err != nil {
		return nil, err
	}
	_, gateway, _, err := router.Route(net.IPv4zero)
	if err != nil || gateway == nil || gateway.IsUnspecified() {
		return nil, errors.New("no UPnP mapping or default NAT-PMP gateway found")
	}
	return mapPMP(natpmp.NewClientWithTimeout(gateway, 2*time.Second), internalPort, externalPort)
}

func maintainMapping(ctx context.Context, m *portMapping, interval time.Duration, onError func(error)) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		defer close(done)
		timer := time.NewTicker(interval)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				attemptCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
				err := m.renew(attemptCtx)
				cancel()
				if err != nil && ctx.Err() == nil {
					onError(err)
				}
			}
		}
	}()
	return done
}
