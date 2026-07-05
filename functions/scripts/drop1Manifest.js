/**
 * Drop 1 production manifest — single source of truth for generated design files.
 *
 * Filename convention (validated against parseDesignFilename):
 *   rally_{token}_rally_{tone}.png   → league RALLY, team rally_brand, tone ∈ light|dark|white
 *
 * TONE = THE GARMENT THE FILE IS USED ON (per fallbackChainForGarmentFamily:
 * dark garment → darkPng first; light garment → lightPng first):
 *   _light = art FOR light garments → BLACK text (#111111)
 *   _dark  = art FOR dark garments  → WHITE text
 *   _white = white-ink artwork slot (pink-garment rule / colorway fallback)
 * Wordmark colorways: colored art in _light and _dark; _white is white-fill.
 *
 * Tokens are unique in their first 8 chars UPPERCASED (SKU segment rule).
 * City line (names + initials) is deferred until city_brand pseudo-team exists.
 */
"use strict";

/** 12-colorway palette (drifted hexes, locked in colorway strategy session). */
const COLORWAYS = [
  { token: "orange", label: "Orange", ink: "orange", hex: "#F15A24", existsInLibrary: true },
  { token: "red", label: "Red", ink: "red", hex: "#D22630" },
  { token: "royal", label: "Royal Blue", ink: "royal blue", hex: "#2A5CAA" },
  { token: "navy", label: "Navy", ink: "navy", hex: "#1C2B4C" },
  { token: "green", label: "Kelly Green", ink: "kelly green", hex: "#00843D" },
  { token: "gold", label: "Gold", ink: "gold", hex: "#F2A900" },
  { token: "purple", label: "Purple", ink: "purple", hex: "#5C2D91" },
  { token: "pink", label: "Pink", ink: "pink", hex: "#EC5BA1" },
  { token: "powder", label: "Powder Blue", ink: "powder blue", hex: "#8ABBE0" },
  { token: "maroon", label: "Maroon", ink: "maroon", hex: "#8A1538" },
  { token: "black", label: "Black", ink: "black", hex: "#111111" },
  { token: "white", label: "White", ink: "white", hex: "#FFFFFF" },
];

/**
 * Copy designs. blanks: review-day target checklist
 * (tanks = TR3008 now, +1822GD when its setup is done; crew = HF07; panty = 8394; thong = 8390).
 */
const DESIGNS = [
  // ---- Know More family (5 sports) — crew + tanks
  { token: "kmbaseball", label: "Knows More Baseball", lines: ["JUST A GIRL WHO", "KNOWS MORE ABOUT", "BASEBALL THAN YOU."], blanks: ["crew", "tanks"] },
  { token: "kmfootball", label: "Knows More Football", lines: ["JUST A GIRL WHO", "KNOWS MORE ABOUT", "FOOTBALL THAN YOU."], blanks: ["crew", "tanks"] },
  { token: "kmbasket", label: "Knows More Basketball", lines: ["JUST A GIRL WHO", "KNOWS MORE ABOUT", "BASKETBALL THAN YOU."], blanks: ["crew", "tanks"] },
  { token: "kmhockey", label: "Knows More Hockey", lines: ["JUST A GIRL WHO", "KNOWS MORE ABOUT", "HOCKEY THAN YOU."], blanks: ["crew", "tanks"] },
  { token: "kmsoccer", label: "Knows More Soccer", lines: ["JUST A GIRL WHO", "KNOWS MORE ABOUT", "SOCCER THAN YOU."], blanks: ["crew", "tanks"] },

  // ---- Fluent family (4 sports) — crew + tanks
  { token: "fluentfb", label: "Fluent Football", lines: ["FLUENT IN", "FOOTBALL."], blanks: ["crew", "tanks"] },
  { token: "fluentbs", label: "Fluent Baseball", lines: ["FLUENT IN", "BASEBALL."], blanks: ["crew", "tanks"] },
  { token: "fluentbk", label: "Fluent Basketball", lines: ["FLUENT IN", "BASKETBALL."], blanks: ["crew", "tanks"] },
  { token: "fluenthk", label: "Fluent Hockey", lines: ["FLUENT IN", "HOCKEY."], blanks: ["crew", "tanks"] },

  // ---- Know-ball family
  { token: "hotgirls", label: "Hot Girls Know Ball", lines: ["HOT GIRLS KNOW BALL."], align: "center", blanks: ["crew", "tanks", "panty"] },
  { token: "knowball", label: "Know Ball Number", lines: ["MUST KNOW BALL", "IF YOU WANT", "MY NUMBER."], blanks: ["tanks"] },

  // ---- She-talks-to-him
  { token: "womsplbb", label: "Womansplain Baseball", lines: ["DON'T MAKE ME", "WOMANSPLAIN", "BASEBALL TO YOU."], blanks: ["tanks"] },
  { token: "womsplfb", label: "Womansplain Football", lines: ["DON'T MAKE ME", "WOMANSPLAIN", "FOOTBALL TO YOU."], blanks: ["tanks"] },
  { token: "mansplain", label: "Another Beer", lines: ["I DON'T NEED YOU", "TO MANSPLAIN.", "I NEED YOU TO GET", "ME ANOTHER BEER."], blanks: ["tanks"] },
  { token: "drinkson", label: "Drinks On You", lines: ["DRINKS ON YOU", "AFTER THE GAME."], blanks: ["tanks"] },
  { token: "kisscam", label: "Kiss Cam", lines: ["LET'S PRACTICE", "FOR THE KISS CAM."], blanks: ["tanks"] },

  // ---- Parlay family
  { token: "parlayhi", label: "Parlay Hit", lines: ["MY PARLAY HIT,", "SO THIS SHIRT", "WAS FREE."], blanks: ["tanks"] },
  { token: "parlayqu", label: "Parlay Queen", lines: ["PARLAY QUEEN."], align: "center", blanks: ["crew", "panty"] },

  // ---- Gameday
  { token: "tailgate", label: "Gameday MVP", lines: ["TAILGATING,", "SHOTGUNNING,", "BEER-BONGING,", "PARKING-LOT-", "TWERKING,", "MOST-FUN-HAVING,", "GAMEDAY MVP."], blanks: ["tanks"] },
  { token: "baddecfb", label: "Football Bad Decisions", lines: ["FOOTBALL AND", "BAD DECISIONS."], blanks: ["tanks", "panty"] },
  { token: "baddecbs", label: "Baseball Bad Decisions", lines: ["BASEBALL AND", "BAD DECISIONS."], blanks: ["tanks", "panty"] },
  { token: "baddechk", label: "Hockey Bad Decisions", lines: ["HOCKEY AND", "BAD DECISIONS."], blanks: ["tanks", "panty"] },

  // ---- Brand / bridge
  { token: "askme", label: "Ask Me", lines: ["ASK ME ABOUT MY", "RALLY PANTIES."], blanks: ["tanks"] },
  { token: "notluck", label: "Not Luck", lines: ["IT'S NOT LUCK.", "IT'S MY PANTIES."], blanks: ["tanks"] },
  { token: "pillows", label: "Pillows", lines: ["PILLOWS."], align: "center", blanks: ["tanks", "panty"] },

  // ---- Baddie family
  { token: "baddiebb", label: "Baseball Baddie", lines: ["BASEBALL BADDIE."], align: "center", blanks: ["crew", "tanks", "panty", "thong"] },
  { token: "baddiefb", label: "Football Baddie", lines: ["FOOTBALL BADDIE."], align: "center", blanks: ["crew", "tanks", "panty", "thong"] },

  // ---- After dark
  { token: "fantasy", label: "Fantasy Football", lines: ["I PUT THE FANTASY", "IN FANTASY FOOTBALL."], blanks: ["tanks"] },
  { token: "flowers", label: "Floor Seats", lines: ["FLOWERS ARE FINE.", "FLOOR SEATS", "ARE FOREPLAY."], blanks: ["tanks"] },
  { token: "comesoff", label: "Comes Off", lines: ["COMES OFF WHEN WE WIN."], align: "center", blanks: ["tanks", "panty", "thong"] },
  { token: "rubforlu", label: "Rub For Luck", lines: ["(RUB FOR LUCK)"], align: "center", blanks: ["panty", "thong"] },
  { token: "droptd", label: "Will Drop Touchdowns", lines: ["WILL DROP FOR", "TOUCHDOWNS."], blanks: ["panty"] },
  { token: "drophr", label: "Will Drop Home Runs", lines: ["WILL DROP FOR", "HOME RUNS."], blanks: ["panty"] },
];

/** Ink by GARMENT tone slot: _light file gets dark text, _dark file gets white text. */
const INK_FOR_LIGHT_GARMENTS = "#111111"; // goes in the _light file
const INK_FOR_DARK_GARMENTS = "#FFFFFF"; // goes in the _dark file

/**
 * City line — files named city_{token}_city_{tone}.png (team city_brand, teamCode CITY).
 * Colored-ink pattern (like colorways): colored art in _light/_dark, white-fill _white.
 * Ink = drifted palette hexes on NEUTRAL garments only (legal: never team color pairings,
 * never interlocked/monogram initials). nameToken = crew wordmark; initToken = thong initials.
 */
const CITIES = [
  { nameToken: "chicago", initToken: "chi", name: "CHICAGO.", initials: "CHI.", label: "Chicago", ink: "royal blue", hex: "#2A5CAA" },
  { nameToken: "sanfrancisco", initToken: "sf", name: "SAN FRANCISCO.", initials: "SF.", label: "San Francisco", ink: "orange", hex: "#F15A24" },
  { nameToken: "newyork", initToken: "ny", name: "NEW YORK.", initials: "NY.", label: "New York", ink: "navy", hex: "#1C2B4C" },
  { nameToken: "boston", initToken: "bos", name: "BOSTON.", initials: "BOS.", label: "Boston", ink: "kelly green", hex: "#00843D" },
  { nameToken: "philadelphia", initToken: "phi", name: "PHILADELPHIA.", initials: "PHI.", label: "Philadelphia", ink: "kelly green", hex: "#00843D" },
  { nameToken: "losangeles", initToken: "la", name: "LOS ANGELES.", initials: "LA.", label: "Los Angeles", ink: "gold", hex: "#F2A900" },
  { nameToken: "dallas", initToken: "dal", name: "DALLAS.", initials: "DAL.", label: "Dallas", ink: "navy", hex: "#1C2B4C" },
  { nameToken: "detroit", initToken: "det", name: "DETROIT.", initials: "DET.", label: "Detroit", ink: "royal blue", hex: "#2A5CAA" },
  { nameToken: "denver", initToken: "den", name: "DENVER.", initials: "DEN.", label: "Denver", ink: "orange", hex: "#F15A24" },
  { nameToken: "greenbay", initToken: "gb", name: "GREEN BAY.", initials: "GB.", label: "Green Bay", ink: "gold", hex: "#F2A900" },
  { nameToken: "buffalo", initToken: "buf", name: "BUFFALO.", initials: "BUF.", label: "Buffalo", ink: "royal blue", hex: "#2A5CAA" },
  { nameToken: "pittsburgh", initToken: "pit", name: "PITTSBURGH.", initials: "PIT.", label: "Pittsburgh", ink: "gold", hex: "#F2A900" },
];

module.exports = { COLORWAYS, DESIGNS, CITIES, INK_FOR_LIGHT_GARMENTS, INK_FOR_DARK_GARMENTS };
