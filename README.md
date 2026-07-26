# ATM10 Lite — In-Game Guides

A browsable website of **every in-game guide book** that ships with the
[All the Mods 10 Lite](https://www.curseforge.com/minecraft/modpacks/all-the-mods-10-lite)
modpack (Minecraft 1.21.1 / NeoForge).

The content is not hand-written. It is extracted from the modpack's own sources —
the mod jars and the pack's GitHub repository — so it always matches what you
actually see in game.

## Regenerating the site content

```bash
npm install
npm run generate
```

That single command:

1. resolves the pack's mod list for the latest published release (CurseForge
   project `1298400`, read through the keyless FTB mirror — **no API key needed**),
2. downloads every mod jar to `.cache/jars/` and verifies it against the SHA-1
   from the manifest (cached, so later runs are instant),
3. scans all jars for guide content and extracts it,
4. pulls the pack's own FTB Quests book from `AllTheMods/ATM-10-L` on GitHub,
5. writes the site data and the referenced images into `public/data/`.

Then run the site:

```bash
npm run dev      # http://localhost:5173
npm run build    # static output in dist/
```

### Options

| Flag | Purpose |
| --- | --- |
| `--version <name\|id>` | Build a specific pack release instead of the newest one |
| `--mods-dir <path>` | Read jars from an installed instance instead of downloading |
| `--project <id>` | Point at a different CurseForge modpack |
| `--repo <owner/name>` `--ref <branch>` | Where to read the quest book from |
| `--skip-quests` | Skip the GitHub round-trip |
| `--out <dir>` `--cache <dir>` | Relocate output / jar cache |
| `--pretty` | Pretty-print the JSON (much larger) |

Examples:

```bash
# Build from a local CurseForge/Prism instance
npm run generate -- --mods-dir ~/curseforge/minecraft/Instances/ATM10Lite/mods

# Rebuild an older pack release
npm run generate -- --version "All The Mods 10 LITE-1.0.0"
```

Set `GITHUB_TOKEN` if you hit GitHub's unauthenticated rate limit while
fetching the quest book.

## What gets extracted

Four different guide systems ship inside this pack, each with its own format.
All four are normalised into one block/inline model that the site renders
uniformly.

| System | Where it lives | Books found |
| --- | --- | --- |
| **FTB Quests** | `config/ftbquests/quests/**.snbt` in the pack repo | the pack's Quest Book |
| **Patchouli** | `data/<ns>/patchouli_books/` + `assets/<ns>/patchouli_books/` | Apotheosis, Croptopia, Industrial Foregoing, Modular Routers, RFTools, Allthemodium, Extended Crafting, Iron's Spells |
| **Modonomicon** | `data/<ns>/modonomicon/books/` | Occultism's Dictionary of Spirits |
| **GuideME** | `assets/<ns>/ae2guide/`, `assets/<ns>/guides/` | Applied Energistics 2 (plus its addons), Powah |

Some details the extractors handle that are easy to get wrong:

- **Patchouli books are shared.** A book belongs to the namespace that declares
  `book.json`, but *any* mod may add entries under that book's folder name.
  When two unrelated mods happen to use the same folder name (Croptopia and
  Extended Crafting both use `guide`) they stay separate books.
- **AE2's guide is a merge.** Advanced AE, Extended AE, MEGA Cells, AppliedFlux
  and AE2WTLib all contribute pages into the one AE2 guide, exactly as in game.
  Each entry records which mod it came from.
- **Text is not plain text.** Patchouli's `$(…)` macros, Modonomicon's
  `[#](aa00aa)` colour spans and FTB's `&a` colour codes are all parsed into
  real styling rather than being stripped or shown raw.
- **Translations are resolved** through each mod's `en_us.json`, since most
  books store lang keys rather than English.

Things that cannot be reproduced outside the game — interactive 3D scenes,
multiblock previews, config-derived numbers and recipe grids — are rendered as
labelled placeholders rather than silently dropped.

## Layout

```
tools/
  generate.mjs          CLI entry point and orchestration
  lib/                  jar/CDN access, SNBT, lang registry, text parsing
  extract/              one module per guide system
src/                    React + Tailwind site
public/data/            generated — index.json, books/*.json, search.json, img/
```

## Licensing

All guide text and images belong to their respective mod authors; this project
only reformats content the mods already ship. It is not affiliated with the
All the Mods team.
