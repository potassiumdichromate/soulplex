# 3D character models

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

- Looks without a model keep the built-in character, so you can add models one at a time.
- `_anims` (optional): Mixamo movements shared by every model (same skeleton). Export Walking "In Place".
- Keep each model around 2–5 MB (compress with `gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp`).
