# 3D character models

What to build (art direction, glTF spec, modular outfits): see `docs/CHARACTER_MODELS.md`.

Put GLB files here and list them in `models.json` by outfit look id
(lavender, pinkbomber, creamsuit, lilachoodie, midnight, sheerlilac, tealvarsity,
blackbomber, mintcardigan, butterpuffer, rosedenim, skytrack, coraloverhirt, plumcoat, sagehoodie):

```json
{
  "_anims": ["idle.glb", "walk.glb", "sit.glb", "talk.glb"],
  "lavender": "lavender.glb",
  "blackbomber": "black-bomber.glb",
  "*": "fallback.glb"
}
```

- `"*m"` / `"*f"` (optional): the model for every men's / women's look without its own file; `"*"` covers anything left.
- Looks without a model keep the built-in character, so you can add models one at a time. A model that fails to load keeps it too.
- `_anims` (optional): Mixamo movements shared by every model (same skeleton). Export Walking "In Place".
- Keep each model around 2–5 MB (compress with `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp`).

## Current models

| File | Look | Made with | Triangles | Clips |
|---|---|---|---|---|
| `midnight.glb` | Midnight Shirt (men, and every men's look via `*m`) | Meshy image-to-3D (meshy-t2.5 + meshy-n1), Meshy auto-rig + animations | 15.7k | Idle, Walking, Sitting_Idle, Sitting_Talking, Talking |
| `creamsuit.glb` | Cream Suit (women, and every women's look via `*f`) | same | 12.9k | same |

Editable sources (`.gltf` + `.bin` + PNG, 2048² texture) are in `art-src/characters/meshy-*`. These are whole
figures with the clothes fused to the body, not the modular base body + garments of `docs/CHARACTER_MODELS.md`.
