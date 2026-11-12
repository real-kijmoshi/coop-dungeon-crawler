package main

// Types mirroring the JSON the server sends (see server/game/World.js
// stateFor / profileFor). Numbers that may not be integers are float64.

type Color [3]int

type Stats struct {
	HP        float64 `json:"hp"`
	MaxHP     float64 `json:"maxHp"`
	Atk       float64 `json:"atk"`
	Def       float64 `json:"def"`
	Crit      float64 `json:"crit"`
	Dodge     float64 `json:"dodge"`
	Lifesteal float64 `json:"lifesteal"`
	GoldFind  float64 `json:"goldFind"`
	XPBonus   float64 `json:"xpBonus"`
	Regen     float64 `json:"regen"`
	Level     int     `json:"level"`
	XP        float64 `json:"xp"`
	XPNext    float64 `json:"xpNext"`
	Gold      float64 `json:"gold"`
	Potions   int     `json:"potions"`
	Kills     int     `json:"kills"`
	Deaths    int     `json:"deaths"`
	MaxDepth  int     `json:"maxDepth"`
	BossKills int     `json:"bossKills"`
}

type Buff struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Until float64 `json:"until"`
}

type Skill struct {
	ID       string  `json:"id"`
	Key      string  `json:"key"`
	Name     string  `json:"name"`
	Level    int     `json:"level"`
	Cooldown float64 `json:"cooldown"`
	ReadyAt  float64 `json:"readyAt"`
}

type QuestBrief struct {
	Desc string  `json:"desc"`
	Have float64 `json:"have"`
	Need float64 `json:"need"`
}

type Combo struct {
	Count int     `json:"count"`
	Until float64 `json:"until"`
}

type PlayerState struct {
	ID           int          `json:"id"`
	Username     string       `json:"username"`
	Title        string       `json:"title"`
	Prestige     int          `json:"prestige"`
	Cls          string       `json:"cls"`
	ClassName    string       `json:"className"`
	ClassColor   Color        `json:"classColor"`
	X            int          `json:"x"`
	Y            int          `json:"y"`
	Stats        Stats        `json:"stats"`
	EffAtk       float64      `json:"effAtk"`
	EffDef       float64      `json:"effDef"`
	DownedUntil  *float64     `json:"downedUntil"`
	Safe         bool         `json:"safe"`
	DodgeReadyAt *float64     `json:"dodgeReadyAt"`
	Combo        *Combo       `json:"combo"`
	Buffs        []Buff       `json:"buffs"`
	Skills       []Skill      `json:"skills"`
	Quests       []QuestBrief `json:"quests"`
	Unity        *Unity       `json:"unity"`
}

type Event struct {
	Name  string  `json:"name"`
	Desc  string  `json:"desc"`
	Until float64 `json:"until"`
	Color Color   `json:"color"`
}

type Point struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type View struct {
	OriginX int      `json:"originX"`
	OriginY int      `json:"originY"`
	Grid    [][]*int `json:"grid"`
}

type Monster struct {
	ID       int     `json:"id"`
	Name     string  `json:"name"`
	Char     string  `json:"char"`
	Color    Color   `json:"color"`
	X        int     `json:"x"`
	Y        int     `json:"y"`
	HP       float64 `json:"hp"`
	MaxHP    float64 `json:"maxHp"`
	Level    int     `json:"level"`
	Boss     bool    `json:"boss"`
	Elite    bool    `json:"elite"`
	Frozen   bool    `json:"frozen"`
	Charging bool    `json:"charging"`
	Windup   bool    `json:"windup"`
	Exposed  bool    `json:"exposed"`
	Primed   string  `json:"primed"`
	Enraged  bool    `json:"enraged"`
	Hit      bool    `json:"hit"`
	Hunting  bool    `json:"hunting"`
	// Team combat (see server/game/teamplay.js): poise is 0..1 for elites and
	// bosses, nil for everything else.
	Poise     *float64 `json:"poise"`
	Staggered bool     `json:"staggered"`
	Sealed    bool     `json:"sealed"`
	Chain     int      `json:"chain"`
}

// Unity is the shared party meter that powers a RALLY.
type Unity struct {
	Value float64 `json:"value"`
	Max   float64 `json:"max"`
}

// Rune is one tile of a boss's abyssal seal; Lit while a hero stands on it.
type Rune struct {
	X     int     `json:"x"`
	Y     int     `json:"y"`
	Lit   bool    `json:"lit"`
	Until float64 `json:"until"`
}

type FloorItem struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Kind  string `json:"kind"`
	Char  string `json:"char"`
	Color Color  `json:"color"`
}

type NPC struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Name  string `json:"name"`
	Char  string `json:"char"`
	Color Color  `json:"color"`
	Known *bool  `json:"known"`
}

type Ally struct {
	ID       int     `json:"id"`
	Username string  `json:"username"`
	X        int     `json:"x"`
	Y        int     `json:"y"`
	HP       float64 `json:"hp"`
	MaxHP    float64 `json:"maxHp"`
	Downed   bool    `json:"downed"`
	Party    bool    `json:"party"`
	Color    *Color  `json:"color"`
}

type Online struct {
	Username string  `json:"username"`
	Prestige int     `json:"prestige"`
	Party    bool    `json:"party"`
	Cls      string  `json:"cls"`
	Color    Color   `json:"color"`
	Level    int     `json:"level"`
	HP       float64 `json:"hp"`
	MaxHP    float64 `json:"maxHp"`
	Downed   bool    `json:"downed"`
	Depth    int     `json:"depth"`
}

type Biome struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type PartyMember struct {
	Username string  `json:"username"`
	Cls      string  `json:"cls"`
	Color    Color   `json:"color"`
	Level    int     `json:"level"`
	HP       float64 `json:"hp"`
	MaxHP    float64 `json:"maxHp"`
	Downed   bool    `json:"downed"`
	X        int     `json:"x"`
	Y        int     `json:"y"`
	Depth    int     `json:"depth"`
}

type PartyState struct {
	Leader  string        `json:"leader"`
	Members []PartyMember `json:"members"`
}

type Invite struct {
	From  string  `json:"from"`
	Until float64 `json:"until"`
}

type Ping struct {
	X     int     `json:"x"`
	Y     int     `json:"y"`
	By    string  `json:"by"`
	Label string  `json:"label"`
	Until float64 `json:"until"`
}

type Threat struct {
	Name   string  `json:"name"`
	Attack string  `json:"attack"`
	HitsAt float64 `json:"hitsAt"`
}

type GameState struct {
	Now           float64     `json:"now"`
	Biome         Biome       `json:"biome"`
	Party         *PartyState `json:"party"`
	Invite        *Invite     `json:"invite"`
	Pings         []Ping      `json:"pings"`
	Player        PlayerState `json:"player"`
	Event         *Event      `json:"event"`
	Depth         int         `json:"depth"`
	AreaLevel     int         `json:"areaLevel"`
	MaxLevel      int         `json:"maxLevel"`
	Home          *Point      `json:"home"`
	SafeRoomID    *int        `json:"safeRoomId"`
	View          View        `json:"view"`
	Danger        [][2]int    `json:"danger"`
	Runes         []Rune      `json:"runes"`
	Threat        *Threat     `json:"threat"`
	Monsters      []Monster   `json:"monsters"`
	Items         []FloorItem `json:"items"`
	NPCs          []NPC       `json:"npcs"`
	NearbyPlayers []Ally      `json:"nearbyPlayers"`
	Online        []Online    `json:"online"`
}

type GearItem struct {
	UID    string             `json:"uid"`
	Slot   string             `json:"slot"`
	Name   string             `json:"name"`
	Base   string             `json:"base"`
	Rarity string             `json:"rarity"`
	Ilvl   int                `json:"ilvl"`
	Stats  map[string]float64 `json:"stats"`
	Value  float64            `json:"value"`
	Plus   int                `json:"plus"`
}

// DisplayName is the item name with its upgrade level.
func (g GearItem) DisplayName() string {
	if g.Plus > 0 {
		return g.Name + " +" + itoa(g.Plus)
	}
	return g.Name
}

type QuestReward struct {
	Gold float64 `json:"gold"`
	XP   float64 `json:"xp"`
	Item bool    `json:"item"`
}

type Quest struct {
	Desc   string      `json:"desc"`
	Have   float64     `json:"have"`
	Need   float64     `json:"need"`
	Reward QuestReward `json:"reward"`
}

type Achievement struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Desc     string `json:"desc"`
	Title    string `json:"title"`
	Unlocked bool   `json:"unlocked"`
}

type ClassSkill struct {
	Name  string `json:"name"`
	Desc  string `json:"desc"`
	Level int    `json:"level"`
}

type ClassInfo struct {
	ID           string       `json:"id"`
	Name         string       `json:"name"`
	Desc         string       `json:"desc"`
	Color        Color        `json:"color"`
	HP           float64      `json:"hp"`
	Atk          float64      `json:"atk"`
	Def          float64      `json:"def"`
	Crit         float64      `json:"crit"`
	Dodge        float64      `json:"dodge"`
	Skills       []string     `json:"skills"`
	SkillDetails []ClassSkill `json:"skillDetails"`
}

type TilePalette struct {
	BG Color `json:"bg"`
	FG Color `json:"fg"`
}

type BiomeInfo struct {
	ID       string      `json:"id"`
	Name     string      `json:"name"`
	From     int         `json:"from"`
	To       int         `json:"to"`
	Floor    TilePalette `json:"floor"`
	Corridor TilePalette `json:"corridor"`
	Wall     Color       `json:"wall"`
}

type WorldInfo struct {
	TierDistance float64     `json:"tierDistance"`
	Biomes       []BiomeInfo `json:"biomes"`
	Story        []string    `json:"story"`
	LoreTotal    int         `json:"loreTotal"`
	RebirthLevel int         `json:"rebirthLevel"`
}

type LoreEntry struct {
	N     int    `json:"n"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

type SmithCost struct {
	Upgrade *float64 `json:"upgrade"`
	Reforge float64  `json:"reforge"`
}

type Chronicle struct {
	Depth int    `json:"depth"`
	Title string `json:"title"`
	Text  string `json:"text"`
}

type Profile struct {
	Prestige      int                  `json:"prestige"`
	Lore          []LoreEntry          `json:"lore"`
	Chronicles    []Chronicle          `json:"chronicles"`
	Waystones     int                  `json:"waystones"`
	World         *WorldInfo           `json:"world"`
	Smith         map[string]SmithCost `json:"smith"`
	Cls           *string              `json:"cls"`
	Equipment     map[string]*GearItem `json:"equipment"`
	Inventory     []GearItem           `json:"inventory"`
	InventorySize int                  `json:"inventorySize"`
	Quests        []Quest              `json:"quests"`
	Title         *string              `json:"title"`
	Achievements  []Achievement        `json:"achievements"`
	Classes       []ClassInfo          `json:"classes"`
}

type ShopItem struct {
	Key         string  `json:"key"`
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Price       float64 `json:"price"`
	Maxed       bool    `json:"maxed"`
	Description string  `json:"description"`
}

type Shop struct {
	Potions     int        `json:"potions"`
	PotionLimit int        `json:"potionLimit"`
	PriceQuotes bool       `json:"priceQuotes"`
	Greeting    string     `json:"greeting"`
	Prestige    int        `json:"prestige"`
	Gold        float64    `json:"gold"`
	Items       []ShopItem `json:"items"`
}

type Fx struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Color *Color `json:"color"`
}

// Sound is a cue from the server; DX, DY are tiles from the hero (0 = here).
type Sound struct {
	Name string  `json:"name"`
	DX   float64 `json:"dx"`
	DY   float64 `json:"dy"`
}

type Floater struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Text  string `json:"text"`
	Color Color  `json:"color"`
}

type ChatMessage struct {
	Text  string `json:"text"`
	Color *Color `json:"color"`
}

type Result struct {
	OK      bool   `json:"ok"`
	Message string `json:"message"`
	Shop    *Shop  `json:"shop"`
}

type TravelDest struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

type TravelOptions struct {
	Can          bool         `json:"can"`
	Reason       *string      `json:"reason"`
	Destinations []TravelDest `json:"destinations"`
}

type LeaderRow struct {
	Prestige  int     `json:"prestige"`
	Username  string  `json:"username"`
	Cls       *string `json:"cls"`
	Title     *string `json:"title"`
	Level     int     `json:"level"`
	MaxDepth  int     `json:"maxDepth"`
	Kills     int     `json:"kills"`
	BossKills int     `json:"bossKills"`
	Deaths    int     `json:"deaths"`
}
