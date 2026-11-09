package main

import (
	"context"
	"errors"
	"github.com/huin/goupnp/soap"
	natpmp "github.com/jackpal/go-nat-pmp"
	"net"
	"sync/atomic"
	"testing"
	"time"
)

type fakeEntry struct {
	internal        uint16
	ip, description string
	lease           uint32
}
type fakeUPnP struct {
	entries        map[uint16]fakeEntry
	added, removed int
}

func noEntry() error { err := &soap.SOAPFaultError{}; err.Detail.UPnPError.Errorcode = 714; return err }
func (f *fakeUPnP) GetExternalIPAddressCtx(context.Context) (string, error) {
	return "93.184.216.34", nil
}
func (f *fakeUPnP) GetSpecificPortMappingEntryCtx(ctx context.Context, host string, port uint16, protocol string) (uint16, string, bool, string, uint32, error) {
	e, ok := f.entries[port]
	if !ok {
		return 0, "", false, "", 0, noEntry()
	}
	return e.internal, e.ip, true, e.description, e.lease, nil
}
func (f *fakeUPnP) AddPortMappingCtx(ctx context.Context, host string, port uint16, protocol string, internal uint16, ip string, enabled bool, desc string, lease uint32) error {
	if protocol != "TCP" || host != "" || !enabled || lease == 0 {
		return errors.New("unexpected mapping scope")
	}
	f.added++
	f.entries[port] = fakeEntry{internal, ip, desc, lease}
	return nil
}
func (f *fakeUPnP) DeletePortMappingCtx(ctx context.Context, host string, port uint16, protocol string) error {
	f.removed++
	delete(f.entries, port)
	return nil
}
func TestUPnPRenewsAndRemovesOnlyItsOwnMapping(t *testing.T) {
	router := &fakeUPnP{entries: map[uint16]fakeEntry{3143: {9999, "192.168.1.99", "other game", 600}}}
	m, err := mapUPnP(context.Background(), upnpCandidate{api: router}, net.ParseIP("192.168.1.20"), 3143, 3143, "our game")
	if err != nil {
		t.Fatal(err)
	}
	if m.externalPort == 3143 {
		t.Fatal("replaced an existing mapping")
	}
	if err = m.renew(context.Background()); err != nil {
		t.Fatal(err)
	}
	if router.added != 2 {
		t.Fatal("mapping was not renewed")
	}
	if err = m.remove(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(router.entries) != 1 || router.entries[3143].description != "other game" || router.removed != 1 {
		t.Fatal("removed someone else's mapping")
	}
}
func TestUPnPDoesNotDeleteAChangedMapping(t *testing.T) {
	router := &fakeUPnP{entries: map[uint16]fakeEntry{}}
	m, err := mapUPnP(context.Background(), upnpCandidate{api: router}, net.ParseIP("192.168.1.20"), 3143, 3143, "our game")
	if err != nil {
		t.Fatal(err)
	}
	router.entries[uint16(m.externalPort)] = fakeEntry{9999, "192.168.1.99", "new owner", 600}
	if m.remove(context.Background()) == nil || router.removed != 0 {
		t.Fatal("deleted another owner's mapping")
	}
}

type pmpCall struct{ internal, external, lifetime int }
type fakePMP struct{ calls []pmpCall }

func (f *fakePMP) GetExternalAddress() (*natpmp.GetExternalAddressResult, error) {
	return &natpmp.GetExternalAddressResult{ExternalIPAddress: [4]byte{93, 184, 216, 34}}, nil
}
func (f *fakePMP) AddPortMapping(protocol string, internal, external, lifetime int) (*natpmp.AddPortMappingResult, error) {
	f.calls = append(f.calls, pmpCall{internal, external, lifetime})
	return &natpmp.AddPortMappingResult{MappedExternalPort: 50001, PortMappingLifetimeInSeconds: 60}, nil
}
func TestNATPMPUsesGrantedPortLeaseAndSendsAnActualDeletion(t *testing.T) {
	client := &fakePMP{}
	m, err := mapPMP(client, 3143, 3143)
	if err != nil {
		t.Fatal(err)
	}
	if m.externalPort != 50001 || m.lease != time.Minute {
		t.Fatal("ignored router's assigned mapping", m)
	}
	if err = m.renew(context.Background()); err != nil {
		t.Fatal(err)
	}
	if client.calls[1].external != 50001 {
		t.Fatal("renewed the wrong port")
	}
	if err = m.remove(context.Background()); err != nil {
		t.Fatal(err)
	}
	last := client.calls[len(client.calls)-1]
	if last.internal != 3143 || last.external != 0 || last.lifetime != 0 {
		t.Fatal("NAT-PMP mapping was not deleted", last)
	}
}
func TestMappingRenewalStopsAndReportsFailure(t *testing.T) {
	var count atomic.Int32
	failed := make(chan error, 10)
	m := &portMapping{renew: func(context.Context) error { count.Add(1); return errors.New("router offline") }}
	ctx, cancel := context.WithCancel(context.Background())
	done := maintainMapping(ctx, m, 5*time.Millisecond, func(err error) { failed <- err })
	select {
	case <-failed:
	case <-time.After(time.Second):
		t.Fatal("renewal did not run")
	}
	cancel()
	<-done
	stopped := count.Load()
	time.Sleep(20 * time.Millisecond)
	if count.Load() != stopped {
		t.Fatal("renewal continued after shutdown")
	}
}
