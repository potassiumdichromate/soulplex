# Soulplex: 3D character models (glTF)

Soulplex shows every person's AI agent as a 3D character walking the date islands,
sitting at café tables and talking on dates. Today these characters are built in code
(`frontend/src/world/character.ts`) with a painted face (`frontend/src/world/faceArt.ts`).
This document describes the **glTF models we want to replace them with**, and how they must
be built so we can **dress the same body in many outfits and keep generating new dresses**.

The one rule that shapes everything below: **a character is assembled, not delivered whole.**
One base body per gender, plus separate hair, tops, bottoms, shoes and accessories that all
share one skeleton. A new dress is one new file, not a new character.

---

## 1. Art direction: "soft film, pastel islands"

- **Style:** stylised 3D animated-film characters (warm, friendly, Pixar/Disney-like
  proportions): slightly large heads, big expressive almond eyes, strong shaped brows, a
  real nose, full lips, warm smiles. Not anime, not realistic, not chibi.
- **People:** adults (25–40), the pilot cities are **Dubai and Delhi NCR**, so the cast is
  mostly South Asian, Arab and mixed, across six skin tones. Men read clearly as men and
  women as women (silhouette, hair, brows, lashes, clothes).
- **Clothes:** the current brand look: oversized knits and jackets, cargo or wide trousers,
  chunky pastel sneakers. Modest options (hijab, turban, long coats) are first-class, not
  extras.
- **World palette:** soft pink and lavender sky and water, pastel islands. Brand accents:
  pink `#ff7eb6`, lavender `#a98bff`, sky `#7ec8ff`, butter `#ffd58a`, mint `#7ef0c9`, cream
  `#f3efe6`.
- **Light in the scene:** soft sky light with a warm sun, neutral tone mapping, a light
  bloom on emissive parts only. Avoid baked lighting in textures.
- **Originality:** all designs must be original. No real person's likeness, no existing
  characters, no brand logos.

## 2. Format: glTF, source and runtime

| | |
|---|---|
| **Source (editable)** | **`.gltf`** (JSON) + `.bin` + PNG textures, one folder per asset in `art-src/characters/`. Human-readable and diff-able, so garments can be edited, re-textured or generated and re-exported |
| **Runtime (in the app)** | **`.glb`** (binary glTF), optimised, in `frontend/public/models/` |
| Axes and units | Y-up, **1 unit = 1 m**, right-handed (glTF default) |
| Pivot | Between the feet, on y = 0 |
| Facing | Character faces **+Z** |
| Pose | **T-pose or A-pose** in the bind pose (A-pose preferred for clothes) |
| Height | Women ~1.65 m, men ~1.78 m. The app rescales to its own height, so this is forgiving, but **all parts of one body must share the same scale** |
| Materials | glTF metallic-roughness PBR. **One material per part** (body, head, each garment, hair) |
| Textures | Base colour (+ optional normal, ORM). Body and head 1024², garments 512–1024², hair 512². Embedded in the source folder as PNG |
| Compression | Deliver uncompressed. We run `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 1024` before shipping. The app loads meshopt-compressed models |
| Animation | Embedded clips, see section 5 |

## 3. The modular character

### 3.1 Base bodies

| File | What |
|---|---|
| `base-female.gltf` | Female body with head, eyes, teeth, tongue, wearing a neutral fitted underlayer (tank top and shorts) so nothing is ever indecent when a garment is missing |
| `base-male.gltf` | Male body, same parts, neutral tee and shorts |
| `base-neutral.gltf` *(optional, P2)* | Androgynous body for people who choose non-binary or prefer not to say |

Inside each base body, split the skin into **separately named meshes** so garments can
hide what they cover (this removes skin poking through clothes):

`Body_Head`, `Body_Neck`, `Body_Torso`, `Body_ArmUpper`, `Body_ArmLower`, `Body_Hands`,
`Body_Hips`, `Body_LegUpper`, `Body_LegLower`, `Body_Feet`, `Eyes`, `Teeth`, `Tongue`.

### 3.2 Skeleton (shared by everything)

- **Mixamo-compatible bone names** (`mixamorig:Hips`, `mixamorig:Spine`, …,
  `mixamorig:LeftHand`, …). One skeleton per base body; every garment and hair file for that
  body is skinned to **exactly the same bones** (same names, same rest pose).
- **Full fingers:** thumb, index, middle, ring and little, three joints each. Hands must look
  human: a palm, separated fingers, nails optional. No mitten hands.
- Optional face bones: `Jaw`, `LeftEye`, `RightEye` (for looking at the other agent).

### 3.3 Face: expressions as morph targets

The head carries **morph targets (blend shapes) with ARKit names**, so the app can blink,
smile and talk:

**Required:** `eyeBlinkLeft`, `eyeBlinkRight`, `jawOpen`, `mouthSmileLeft`,
`mouthSmileRight`, `mouthFunnel`, `mouthPucker`, `browInnerUp`, `browDownLeft`,
`browDownRight`, `cheekSquintLeft`, `cheekSquintRight`.

**Nice to have:** the full 52 ARKit set, plus visemes `viseme_aa`, `viseme_E`, `viseme_I`,
`viseme_O`, `viseme_U`, `viseme_PP`, `viseme_FF` for lip-sync.

Faces are personalised in the app (eye colour, brow shape, lip colour, smile), so the head's
UVs must keep the **eyes, brows and lips in their own, unstretched UV islands**, and the
iris should be a separate material or UV island that can be recoloured.

### 3.4 Garments and accessories (the "dresses")

Every garment is its **own file**, made on top of one base body:

| Slot | Examples | Naming |
|---|---|---|
| `top` | knit sweater, cropped jacket, blazer, shirt, puffer vest, long coat, hoodie, kurta, abaya top | `top-<id>-<f\|m>.gltf` |
| `bottom` | cargo, tech cargo with straps, wide-leg, straight trousers, skirt, sharara | `bottom-<id>-<f\|m>.gltf` |
| `dress` | one-piece dresses, jumpsuits, abaya (replaces top **and** bottom) | `dress-<id>-f.gltf` |
| `shoes` | chunky sneakers, heels, loafers, sandals | `shoes-<id>-<f\|m>.gltf` |
| `hair` | short, long, bun, curly, side part, buzz, wavy | `hair-<id>-<f\|m>.gltf` |
| `headwear` | hijab, turban, beanie, cap | `head-<id>-<f\|m>.gltf` |
| `acc` | bags (sling, chain, box), headphones, glasses, earrings, watch, bracelet, necklace, hair flower | `acc-<id>.gltf` |

**Rules every garment must follow** (so a new dress just works):

1. **Skinned to the base body's skeleton.** Copy weights from the body (for example Blender's
   *Data Transfer* or Meshy auto-rig on the base, then weight transfer) so it moves with the
   body in every clip.
2. **Fits the base body in its bind pose**, 3 to 15 mm off the skin, no intersections in the
   clips listed in section 5, especially sitting.
3. **Declares what it hides.** Add glTF `extras` on the garment's root node listing the body
   meshes it covers, for example:
   `"extras": { "slot": "top", "hides": ["Body_Torso", "Body_ArmUpper", "Body_ArmLower"] }`.
4. **One material, tintable.** Base colour painted in light neutral greys where the colour
   should change, plus a **tint mask** (a second texture, or the material name ending in
   `_tint`) so the app can recolour the same garment into many colourways. Prints, stitching
   and trims stay in the texture.
5. **Separate glowing parts** (the star emblem, strap lights, sneaker stripes) as a second
   material with an emissive colour.
6. **Budget:** tops and dresses 1.5–4k triangles, bottoms 1–3k, shoes 1–2k a pair, hair
   2–5k, accessories under 1k.

### 3.5 Triangle budget for a whole character

Body + head 8–12k triangles, dressed total **under 20k**. Up to 20 characters are on screen
at once, on phones too.

## 4. What to make first (P1)

**Bases:** `base-female`, `base-male`.

**Hair and headwear (both genders where it makes sense):** short, long, bun, curly, side
part, buzz, wavy, turban, hijab.

**The 15 current looks, as garments** (colours here are the defaults; the tint mask makes the
rest):

| Look id | Name | For | Pieces |
|---|---|---|---|
| `lavender` | Lavender Knit | f | oversized puffy-sleeve knit sweater, cargo pants, chunky sneakers, box bag |
| `pinkbomber` | Pink Cropped Jacket | f | cropped bomber over a tee, cargo pants, sneakers |
| `creamsuit` | Cream Suit | f | long open blazer with rolled sleeves, wide-leg trousers, heels |
| `lilachoodie` | Lilac Hoodie Jacket | m | jacket over a hoodie, tech cargo with straps, sneakers |
| `midnight` | Midnight Shirt | m | tucked button-up shirt with rolled sleeves, straight trousers, belt, sneakers |
| `sheerlilac` | Sheer Lilac | f | translucent puffy jacket over a crop top, tech cargo |
| `tealvarsity` | Teal Varsity | m | varsity jacket with sleeve patches, cargo pants, beanie |
| `blackbomber` | Black Bomber | m | black bomber, cargo pants, sneakers, headphones |
| `mintcardigan` | Mint Cardigan | f | puffy cardigan, wide-leg trousers, sneakers |
| `butterpuffer` | Butter Puffer | m | puffer vest over a hoodie, cargo pants, beanie |
| `rosedenim` | Rose Denim | f | denim jacket, wide-leg trousers, sneakers |
| `skytrack` | Sky Track Jacket | all | track jacket, cargo pants, cap |
| `coraloverhirt` | Coral Overshirt | m | overshirt with rolled sleeves, cargo pants, sling bag |
| `plumcoat` | Plum Coat | f | long coat to the knee, straight trousers, sneakers |
| `sagehoodie` | Sage Hoodie | all | oversized hoodie, cargo pants, sneakers |

**P2, new dresses** (to prove the pipeline): a sundress, a kurta with trousers, an abaya, a
saree-inspired drape, a linen shirt and chinos, a light suit for "dinner" dates.

## 5. Animation clips

Embed these in each base body (garments use the same skeleton, so they inherit them).
Loopable, **in place** (no root motion), 30 fps. Names are matched case-insensitively and by
"contains":

| Clip | Used for |
|---|---|
| `Idle` | standing on the island |
| `Walking` | walking between spots (in place) |
| `Sitting_Idle` | seated at café tables, benches, picnic blankets |
| `Sitting_Talking` | the date conversation while seated |
| `Talking` | standing conversations (walk dates, gallery, pier) |
| `Wave` | greeting the other agent |
| `Laugh` | a good moment in the conversation |
| `Nod` | listening |
| `Thinking` *(nice to have)* | a pause before an answer |

The app today picks up any clip whose name contains `idle`, `walk`, `sit` or `talk`, and
Mixamo clips that share the skeleton can also be supplied separately (see
`frontend/public/models/README.md`).

## 6. Delivery and folder layout

```
art-src/characters/
  base-female/            base-female.gltf, .bin, textures/*.png
  base-male/
  top-lavender-knit-f/
  bottom-cargo-f/
  hair-long-f/
  ...
frontend/public/models/   optimised .glb files and models.json
```

Send source folders (`.gltf` + `.bin` + PNG). We optimise and register them.

## 7. How the app uses the files

**Today (works now):** `frontend/public/models/models.json` maps an outfit look id to one
complete GLB, and a look without a model keeps the code-built character:

```json
{ "_anims": ["idle.glb", "walk.glb", "sit.glb", "talk.glb"], "lavender": "lavender.glb", "*": "fallback.glb" }
```

**Next (to build when the first base body arrives):** an assembler that loads the person's
base body, then hair, top, bottom, shoes and accessories from their profile, binds every
part to the body's skeleton, hides the covered body meshes, applies the tint colours, skin
tone and face settings, and drives the face morph targets (blink, smile, talking). The
manifest will grow to:

```json
{
  "bases": { "f": "base-female.glb", "m": "base-male.glb" },
  "parts": {
    "top-lavender-knit-f": { "file": "top-lavender-knit-f.glb", "slot": "top", "base": "f" },
    "hair-long-f": { "file": "hair-long-f.glb", "slot": "hair", "base": "f" }
  },
  "looks": {
    "lavender": { "f": ["top-lavender-knit-f", "bottom-cargo-f", "shoes-chunky-f", "acc-box-bag"] }
  }
}
```

New dresses then only need a file, a manifest line and a colourway.

## 8. Generating new dresses with AI tools

Text- or image-to-3D tools (for example Meshy) produce a whole figure with the clothes fused
to the body, which cannot be re-dressed. To use them for garments:

1. Generate or texture the garment **on our base body** (image-to-3D from a turntable of
   the base body wearing the design, or Meshy's retexture on an existing garment mesh for new
   colours and prints).
2. Separate the garment from the body, clean it to the triangle budget, and fit it to the
   base body's bind pose.
3. Transfer skin weights from the base body, add the `extras` (`slot`, `hides`) and the tint
   mask.
4. Export as `.gltf`, check it in all clips in section 5, then optimise to `.glb`.

## 9. Acceptance checklist (per file)

- [ ] Opens in <https://gltf-viewer.donmccurdy.com/> with no errors or warnings
- [ ] Y-up, metres, faces +Z, pivot at the feet
- [ ] Uses the base body's skeleton names exactly; no extra root transforms
- [ ] No skin poke-through in `Idle`, `Walking`, `Sitting_Idle`, `Sitting_Talking`
- [ ] `extras.slot` and `extras.hides` set; tint mask present
- [ ] Within the triangle and texture budget
- [ ] Hands have five separated fingers; face morph targets have the ARKit names
- [ ] Original design, and the licence allows commercial use
