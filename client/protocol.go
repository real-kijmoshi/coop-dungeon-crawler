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
	ID          int          `json:"id"`
	Username    string       `json:"username"`
	Title       string       `json:"title"`
	Cls         string       `json:"cls"`
	ClassName   string       `json:"className"`
	ClassColor  Color        `json:"classColor"`
	X           int          `json:"x"`
	Y           int          `json:"y"`
	Stats       Stats        `json:"stats"`
	EffAtk      float64      `json:"effAtk"`
	EffDef      float64      `json:"effDef"`
	DownedUntil *float64     `json:"downedUntil"`
	Safe        bool         `json:"safe"`
	Combo       *Combo       `json:"combo"`
	Buffs       []Buff       `json:"buffs"`
	Skills      []Skill      `json:"skills"`
	Quests      []QuestBrief `json:"quests"`
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
	ID      int     `json:"id"`
	Name    string  `json:"name"`
	Char    string  `json:"char"`
	Color   Color   `json:"color"`
	X       int     `json:"x"`
	Y       int     `json:"y"`
	HP      float64 `json:"hp"`
	MaxHP   float64 `json:"maxHp"`
	Boss    bool    `json:"boss"`
	Elite   bool    `json:"elite"`
	Frozen  bool    `json:"frozen"`
	Hit     bool    `json:"hit"`
	Hunting bool    `json:"hunting"`
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
}

type Ally struct {
	ID       int     `json:"id"`
	Username string  `json:"username"`
	X        int     `json:"x"`
	Y        int     `json:"y"`
	HP       float64 `json:"hp"`
	MaxHP    float64 `json:"maxHp"`
	Downed   bool    `json:"downed"`
	Color    *Color  `json:"color"`
}

type Online struct {
	Username string  `json:"username"`
	Cls      string  `json:"cls"`
	Color    Color   `json:"color"`
	Level    int     `json:"level"`
	HP       float64 `json:"hp"`
	MaxHP    float64 `json:"maxHp"`
	Downed   bool    `json:"downed"`
	Depth    int     `json:"depth"`
}

type GameState struct {
	Now           float64     `json:"now"`
	Player        PlayerState `json:"player"`
	Event         *Event      `json:"event"`
	Depth         int         `json:"depth"`
	Home          *Point      `json:"home"`
	SafeRoomID    *int        `json:"safeRoomId"`
	View          View        `json:"view"`
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

type ClassInfo struct {
	ID     string   `json:"id"`
	Name   string   `json:"name"`
	Desc   string   `json:"desc"`
	Color  Color    `json:"color"`
	HP     float64  `json:"hp"`
	Atk    float64  `json:"atk"`
	Def    float64  `json:"def"`
	Crit   float64  `json:"crit"`
	Dodge  float64  `json:"dodge"`
	Skills []string `json:"skills"`
}

type Profile struct {
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
	Key   string  `json:"key"`
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

type Shop struct {
	Gold  float64    `json:"gold"`
	Items []ShopItem `json:"items"`
}

type Fx struct {
	Type  string `json:"type"`
	Text  string `json:"text"`
	Color *Color `json:"color"`
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

type LeaderRow struct {
	Username  string  `json:"username"`
	Cls       *string `json:"cls"`
	Title     *string `json:"title"`
	Level     int     `json:"level"`
	MaxDepth  int     `json:"maxDepth"`
	Kills     int     `json:"kills"`
	BossKills int     `json:"bossKills"`
	Deaths    int     `json:"deaths"`
}
