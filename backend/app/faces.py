"""Agent faces.

A face is either an illustrated avatar (a small JSON spec the client renders)
or a photo. A photo carries two images, both made in the owner's browser:

* ``photo``: the styled photo the owner chose
* ``public``: what others see while ``reveal == "mutual"``, a soft-focus version

The server decides per viewer which image to send, so an unrevealed photo
never leaves the server for someone who is not a mutual match.
"""

import re

OPTIONS = {
    "skin": 6,
    "hair": 9,
    "hairColor": 7,
    "eyes": 3,
    "brows": 3,
    "mouth": 3,
    "facial": 3,
    "accessory": 5,
    "outfit": 6,
    "look": 16,  # 0 auto, 1-15 the cast's 3D outfit styles
}
DATA_URL = re.compile(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$")
MAX_IMAGE = 120_000  # characters of base64, roughly 90 KB


def clean_spec(spec):
    if not isinstance(spec, dict):
        raise ValueError("Invalid face.")
    out = {}
    for k, n in OPTIONS.items():
        v = spec.get(k, 0)
        if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v < n:
            raise ValueError(f"Invalid face option: {k}.")
        out[k] = v
    return out


def clean_image(value):
    if not isinstance(value, str) or len(value) > MAX_IMAGE or not DATA_URL.match(value):
        raise ValueError("Upload a JPEG, PNG or WebP image under 90 KB after cropping.")
    return value


def view(face, *, owner=False, revealed=False):
    """What a given viewer may see of someone's face."""
    face = face or {}
    if face.get("kind") == "photo":
        if owner:
            return dict(face)
        open_ = face.get("reveal") == "everyone" or revealed
        return {
            "kind": "photo",
            "image": face["photo"] if open_ else face["public"],
            "locked": not open_,
        }
    if face.get("kind") == "illustrated":
        return {"kind": "illustrated", "spec": face.get("spec", {})}
    if face.get("kind") == "cast":  # fictional members drawn as the Soulplex cast
        return {"kind": "cast", "id": face.get("id", "")}
    return {}
