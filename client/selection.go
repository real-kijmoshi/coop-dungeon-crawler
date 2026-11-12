package main

import "encoding/json"

func (g *Game) classKey(name string, r rune, up, down bool) {
	if g.selectionPending {
		return
	}
	if name == "q" {
		g.toMenu, g.quit = true, true
		return
	}
	if g.profile == nil || len(g.profile.Classes) == 0 {
		return
	}
	count := len(g.profile.Classes)
	switch {
	case up || down || (r >= '1' && int(r-'1') < count):
		if up {
			g.classCursor = maxi(0, g.classCursor-1)
		} else if down {
			g.classCursor = mini(count-1, g.classCursor+1)
		} else {
			g.classCursor = int(r - '1')
		}
		g.classConfirm = false
	case name == "Esc":
		g.classConfirm = false
	case name == "Enter":
		if g.classConfirm {
			if !g.connected {
				return
			}
			g.selectionPending = true
			g.conn.Request("chooseClass", func(raw json.RawMessage) {
				g.selectionPending = false
				var result Result
				if json.Unmarshal(raw, &result) != nil {
					result.Message = "Could not confirm your class. Try again."
				}
				g.classConfirm = false
				if result.OK {
					// Some servers acknowledge the class without sending a story event.
					g.beginHeroIntro()
				} else if g.overlay != nil && g.overlay.Kind == "class" {
					note := L(result.Message, cRed)
					g.showClassSelect(&note)
				}
			}, g.profile.Classes[g.classCursor].ID)
			return
		}
		g.classConfirm = true
	default:
		return
	}
	g.showClassSelect(nil)
}

func (g *Game) shopKey(name string, r rune, up, down bool) {
	if g.selectionPending {
		return
	}
	s := g.overlay.shop
	if s == nil || len(s.Items) == 0 {
		g.overlay = nil
		return
	}
	switch {
	case up:
		g.shopCursor = maxi(0, g.shopCursor-1)
	case down:
		g.shopCursor = mini(len(s.Items)-1, g.shopCursor+1)
	case r >= '1' && r <= '9':
		for i, it := range s.Items {
			if it.Key == string(r) {
				g.shopCursor = i
				break
			}
		}
	case name == "Enter":
		it := s.Items[g.shopCursor]
		if g.shopStatus(s, it) != "" || !g.connected {
			return
		}
		if !g.shopConfirm {
			g.shopConfirm = true
			g.showShop(s, nil)
			return
		}
		g.selectionPending = true
		quote := []any{it.ID}
		if s.PriceQuotes { // Legacy merchants accept just the item ID.
			quote = append(quote, it.Price)
		}
		g.conn.Request("buy", func(raw json.RawMessage) {
			g.selectionPending, g.shopConfirm = false, false
			var result Result
			if json.Unmarshal(raw, &result) != nil {
				result.Message = "Purchase status unavailable. Reopen the merchant to check your gold."
			}
			note := L(result.Message, cRed)
			if result.OK {
				note = L("Purchased: "+it.Name, cGreen)
			}
			if result.Shop != nil {
				s = result.Shop
			}
			g.showShop(s, &note)
		}, quote...)
		return
	case name == "Esc" || name == "q":
		if !g.shopConfirm {
			g.overlay = nil
			return
		}
	case name == "x":
		g.invAction("selljunk", nil)
		// Reopening gets current gold and potion counts from the merchant.
		g.overlay = nil
		return
	case name == "i":
		g.invCursor = 3
		g.showInventory(nil)
		return
	default:
		return
	}
	g.shopConfirm = false
	g.showShop(s, nil)
}
