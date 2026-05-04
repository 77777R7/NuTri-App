import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROUTE_PATH = path.resolve(__dirname, "../src/routes/enrichStreamRoute.ts");

test("enrich-stream product_info hydrates Sports Research 90284 images from overlay claims", async () => {
  const routeSource = await readFile(ROUTE_PATH, "utf8");
  const sportsResearchOmega3 = {
    productId: "90284",
    barcodeGtin14: "00023249011835",
    expectedOverlayImage:
      "https://cloudinary.images-iherb.com/image/upload/f_auto,q_auto:eco/images/sre/sre01183/u/127.jpg",
  };

  assert.equal(sportsResearchOmega3.productId, "90284");
  assert.equal(sportsResearchOmega3.barcodeGtin14, "00023249011835");
  assert.equal(
    new URL(sportsResearchOmega3.expectedOverlayImage).hostname.endsWith(
      "images-iherb.com",
    ),
    true,
  );

  assert.match(routeSource, /const pickPreferredProductImageUrl = \(/);
  assert.doesNotMatch(routeSource, /const cachedOverlayClaims = await/);
  assert.match(
    routeSource,
    /let cachedOverlayClaims: DecisionSupportOverlayClaims \| null = null;[\s\S]*?cachedOverlayClaims = await getOverlayClaimsForBarcode\(\);/,
  );
  assert.match(
    routeSource,
    /const overlayImageUrl = options\?\.overlayClaims\?\.imageUrl \?\? null;/,
  );
  assert.match(routeSource, /overlayClaims:\s*cachedOverlayClaims/);
  assert.match(routeSource, /overlayClaims:\s*await getOverlayClaimsForBarcode\(\)/);
  assert.match(
    routeSource,
    /image:\s*pickPreferredProductImageUrl\(\s*overlayImageUrl,\s*catalog\?\.imageUrl,\s*workingAnalysisPayload\?\.productInfo\?\.image,\s*snapshot\.product\.imageUrl,\s*\)/,
  );
  assert.match(
    routeSource,
    /const overlayImageUrl = \(await getOverlayClaimsForBarcode\(\)\)\?\.imageUrl \?\? null;[\s\S]*?image:\s*pickPreferredProductImageUrl\(\s*overlayImageUrl,\s*catalog\.imageUrl,/,
  );
});
