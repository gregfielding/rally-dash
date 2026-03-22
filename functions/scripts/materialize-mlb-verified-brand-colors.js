#!/usr/bin/env node
/**
 * Writes functions/data/mlbVerifiedBrandColors.json — hand-picked MLB brand hex values;
 * CMYK is sRGB→CMYK of those hexes only (colors are not chosen by algorithm).
 *
 *   npm run materialize:mlb-verified-colors
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { hexToCmyk, normalizeHex } = require("../data/teamColorUtils");

function color(role, name, hex) {
  const h = normalizeHex(hex);
  return { role, name, hex: h, cmyk: hexToCmyk(h) };
}

/** Hand-picked from MLB / club style guides and widely cited brand references. */
const ROWS = [
  {
    id: "arizona_diamondbacks",
    colorFamilies: ["red", "teal"],
    teamColors: [
      color("primary", "Sedona Red", "#A71930"),
      color("secondary", "Sonoran Teal", "#30CED8"),
    ],
  },
  {
    id: "atlanta_braves",
    colorFamilies: ["navy", "red"],
    teamColors: [
      color("primary", "Scarlet", "#CE1141"),
      color("secondary", "Navy", "#13274F"),
    ],
  },
  {
    id: "baltimore_orioles",
    colorFamilies: ["orange", "black"],
    teamColors: [
      color("primary", "Orange", "#DF4601"),
      color("secondary", "Black", "#000000"),
    ],
  },
  {
    id: "boston_red_sox",
    colorFamilies: ["red", "navy"],
    teamColors: [
      color("primary", "Red", "#BD3039"),
      color("secondary", "Navy", "#0C2340"),
    ],
  },
  {
    id: "chicago_cubs",
    colorFamilies: ["blue", "red"],
    teamColors: [
      color("primary", "Cubbies Blue", "#0E3386"),
      color("secondary", "Red", "#CC3433"),
    ],
  },
  {
    id: "chicago_white_sox",
    colorFamilies: ["black", "grey"],
    teamColors: [
      color("primary", "Black", "#27251F"),
      color("secondary", "Silver", "#C4CED4"),
    ],
  },
  {
    id: "cincinnati_reds",
    colorFamilies: ["red", "black"],
    teamColors: [
      color("primary", "Red", "#C6011F"),
      color("secondary", "Black", "#000000"),
    ],
  },
  {
    id: "cleveland_guardians",
    colorFamilies: ["navy", "red"],
    teamColors: [
      color("primary", "Fastball Navy", "#00385D"),
      color("secondary", "Guardians Red", "#E31937"),
    ],
  },
  {
    id: "colorado_rockies",
    colorFamilies: ["purple", "black"],
    teamColors: [
      color("primary", "Purple", "#333366"),
      color("secondary", "Black", "#000000"),
    ],
  },
  {
    id: "detroit_tigers",
    colorFamilies: ["navy", "orange"],
    teamColors: [
      color("primary", "Navy", "#0C2340"),
      color("secondary", "Orange", "#FA4616"),
    ],
  },
  {
    id: "houston_astros",
    colorFamilies: ["orange", "navy"],
    teamColors: [
      color("primary", "Orange", "#EB6E1F"),
      color("secondary", "Navy", "#002D62"),
    ],
  },
  {
    id: "kansas_city_royals",
    colorFamilies: ["blue", "yellow"],
    teamColors: [
      color("primary", "Royal Blue", "#004687"),
      color("secondary", "Gold", "#BD9B60"),
    ],
  },
  {
    id: "los_angeles_angels",
    colorFamilies: ["red", "navy"],
    teamColors: [
      color("primary", "Red", "#BA0022"),
      color("secondary", "Navy", "#003263"),
    ],
  },
  {
    id: "los_angeles_dodgers",
    colorFamilies: ["blue", "red"],
    teamColors: [
      color("primary", "Dodger Blue", "#005A9C"),
      color("secondary", "Red", "#EF3E42"),
    ],
  },
  {
    id: "miami_marlins",
    colorFamilies: ["blue", "red"],
    teamColors: [
      color("primary", "Miami Blue", "#00A3E0"),
      color("secondary", "Caliente Red", "#EF3340"),
    ],
  },
  {
    id: "milwaukee_brewers",
    colorFamilies: ["navy", "yellow"],
    teamColors: [
      color("primary", "Navy Blue", "#12284B"),
      color("secondary", "Yellow", "#FFC52F"),
    ],
  },
  {
    id: "minnesota_twins",
    colorFamilies: ["navy", "red"],
    teamColors: [
      color("primary", "Navy", "#002B5C"),
      color("secondary", "Red", "#D31145"),
    ],
  },
  {
    id: "ny_mets",
    colorFamilies: ["blue", "orange"],
    teamColors: [
      color("primary", "Blue", "#002D72"),
      color("secondary", "Orange", "#FF5910"),
    ],
  },
  {
    id: "ny_yankees",
    colorFamilies: ["navy", "white"],
    teamColors: [
      color("primary", "Navy", "#003087"),
      color("secondary", "White", "#FFFFFF"),
    ],
  },
  {
    id: "oakland_athletics",
    colorFamilies: ["green", "yellow"],
    teamColors: [
      color("primary", "Green", "#003831"),
      color("secondary", "Gold", "#EFB21E"),
    ],
  },
  {
    id: "philadelphia_phillies",
    colorFamilies: ["red", "blue"],
    teamColors: [
      color("primary", "Red", "#E81828"),
      color("secondary", "Blue", "#284898"),
    ],
  },
  {
    id: "pittsburgh_pirates",
    colorFamilies: ["yellow", "black"],
    teamColors: [
      color("primary", "Gold", "#FDB827"),
      color("secondary", "Black", "#000000"),
    ],
  },
  {
    id: "san_diego_padres",
    colorFamilies: ["black", "yellow"],
    teamColors: [
      color("primary", "Brown", "#2F241D"),
      color("secondary", "Gold", "#FFC425"),
    ],
  },
  {
    id: "sf_giants",
    colorFamilies: ["orange", "black"],
    teamColors: [
      color("primary", "Orange", "#FD5A1E"),
      color("secondary", "Black", "#27251F"),
    ],
  },
  {
    id: "seattle_mariners",
    colorFamilies: ["navy", "teal"],
    teamColors: [
      color("primary", "Navy", "#0C2C56"),
      color("secondary", "Northwest Green", "#005C5C"),
    ],
  },
  {
    id: "st_louis_cardinals",
    colorFamilies: ["red", "navy"],
    teamColors: [
      color("primary", "Cardinal Red", "#C41E3A"),
      color("secondary", "Navy", "#0C2340"),
    ],
  },
  {
    id: "tampa_bay_rays",
    colorFamilies: ["navy", "blue"],
    teamColors: [
      color("primary", "Navy", "#092C5C"),
      color("secondary", "Columbia Blue", "#8FBCE6"),
    ],
  },
  {
    id: "texas_rangers",
    colorFamilies: ["blue", "red"],
    teamColors: [
      color("primary", "Blue", "#003278"),
      color("secondary", "Red", "#C0111F"),
    ],
  },
  {
    id: "toronto_blue_jays",
    colorFamilies: ["blue", "red"],
    teamColors: [
      color("primary", "Royal Blue", "#134A8E"),
      color("secondary", "Red", "#E8291C"),
    ],
  },
  {
    id: "washington_nationals",
    colorFamilies: ["red", "navy"],
    teamColors: [
      color("primary", "Red", "#AB0003"),
      color("secondary", "Navy", "#14225A"),
    ],
  },
];

const teams = ROWS.map((row) => {
  const primaryColorHex = row.teamColors[0].hex;
  const secondaryColorHex = row.teamColors[1] ? row.teamColors[1].hex : null;
  return {
    id: row.id,
    colorVerificationStatus: "verified",
    /** CMYK in teamColors is hex-derived until manually confirmed from print specs. */
    printVerificationStatus: "derived",
    colorFamilies: row.colorFamilies,
    primaryColorHex,
    secondaryColorHex,
    teamColors: row.teamColors,
  };
});

if (teams.length !== 30) throw new Error(`Expected 30 teams, got ${teams.length}`);

const payload = {
  schemaVersion: "1",
  leagueCode: "MLB",
  description:
    "Verified MLB brand colors: hex and color names hand-picked from official / widely accepted club and MLB references. colorVerificationStatus=verified (brand identity). CMYK is sRGB→CMYK of those hexes until printVerificationStatus becomes verified. colorFamilies use the Rally normalized eligibility set. Optional pantone on teamColors entries may be added later without changing this file shape.",
  teamCount: 30,
  teams,
};

const outPath = path.join(__dirname, "../data/mlbVerifiedBrandColors.json");
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf8");
console.log("Wrote", outPath);
