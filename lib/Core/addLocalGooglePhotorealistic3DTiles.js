import CatalogMemberFactory from "terriajs/lib/Models/Catalog/CatalogMemberFactory";
import CommonStrata from "terriajs/lib/Models/Definition/CommonStrata";
import upsertModelFromJson from "terriajs/lib/Models/Definition/upsertModelFromJson";

const GOOGLE_TILES_STRATUM = CommonStrata.override;
const GOOGLE_TILES_GROUP_ID = "local-google-map-tiles";
const GOOGLE_TILES_ITEM_ID = `${GOOGLE_TILES_GROUP_ID}/photorealistic-3d`;

function addMemberIfMissing(group, member) {
  if (
    !group.memberModels.some(
      (existingMember) => existingMember.uniqueId === member.uniqueId
    )
  ) {
    group.add(GOOGLE_TILES_STRATUM, member);
  }
}

export default function addLocalGooglePhotorealistic3DTiles(terria) {
  const apiKey = process.env.GOOGLE_MAP_TILES_API_KEY;

  if (!apiKey) {
    return;
  }

  try {
    const group = upsertModelFromJson(
      CatalogMemberFactory,
      terria,
      "/",
      GOOGLE_TILES_STRATUM,
      {
        type: "group",
        id: GOOGLE_TILES_GROUP_ID,
        name: "Google Map Tiles (Local)",
        description:
          "Local-only Google Map Tiles integration powered by GOOGLE_MAP_TILES_API_KEY from .env.local.",
        isOpen: true
      }
    ).throwIfUndefined({
      title: "Failed to create Google Map Tiles group"
    });

    addMemberIfMissing(terria.catalog.group, group);

    const photorealisticTiles = upsertModelFromJson(
      CatalogMemberFactory,
      terria,
      group.uniqueId,
      GOOGLE_TILES_STRATUM,
      {
        type: "3d-tiles",
        id: GOOGLE_TILES_ITEM_ID,
        name: "Google Photorealistic 3D Tiles",
        description:
          "Switch to 3D mode before adding this item. The tileset URL is generated from your local GOOGLE_MAP_TILES_API_KEY.",
        url: `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(
          apiKey
        )}`,
        zoomOnAddToWorkbench: false,
        options: {
          showCreditsOnScreen: true
        }
      }
    ).throwIfUndefined({
      title: "Failed to create Google Photorealistic 3D Tiles item"
    });

    addMemberIfMissing(group, photorealisticTiles);
  } catch (error) {
    terria.raiseErrorToUser(error, {
      title: "Failed to enable local Google Map Tiles integration"
    });
  }
}
