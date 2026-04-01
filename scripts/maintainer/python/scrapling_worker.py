#!/usr/bin/env python3
from html import unescape
import json
import os
import re
import sys
from urllib.parse import urljoin

from lxml import html as lxml_html

SHIM_ROOT = os.path.join(os.path.dirname(__file__), "vendor_shims")
if os.path.isdir(SHIM_ROOT) and SHIM_ROOT not in sys.path:
    sys.path.insert(0, SHIM_ROOT)

try:
    import extruct
    from w3lib.html import get_base_url
except ModuleNotFoundError:
    extruct = None
    get_base_url = None


DOSAGE_FORM_PATTERNS = [
    (re.compile(r"\bsoft[\s-]?gels?\b", re.IGNORECASE), "softgel"),
    (re.compile(r"\bcapsules?\b", re.IGNORECASE), "capsule"),
    (re.compile(r"\bcaplets?\b", re.IGNORECASE), "caplet"),
    (re.compile(r"\btablets?\b", re.IGNORECASE), "tablet"),
    (re.compile(r"\bgummies?\b", re.IGNORECASE), "gummy"),
    (re.compile(r"\blozenges?\b", re.IGNORECASE), "lozenge"),
    (re.compile(r"\bpowders?\b", re.IGNORECASE), "powder"),
    (re.compile(r"\bliquids?\b", re.IGNORECASE), "liquid"),
    (re.compile(r"\bdrops?\b", re.IGNORECASE), "drops"),
    (re.compile(r"\bsprays?\b", re.IGNORECASE), "spray"),
    (re.compile(r"\bchewables?\b", re.IGNORECASE), "chewable"),
]


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def is_codeage_official_product_url(url):
    return bool(re.match(r"^https?://(www\.)?codeage\.com/products/", str(url or ""), flags=re.IGNORECASE))


def unique_list(values):
    seen = set()
    output = []
    for value in values or []:
        normalized = normalize_text(value)
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(normalized)
    return output


def strip_tags(value):
    text = re.sub(r"<br\s*/?>", "\n", str(value or ""), flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return normalize_text(unescape(text))


def parse_sections(text):
    headings = ["Description", "Suggested use", "Other ingredients", "Warnings", "Disclaimer"]
    sections = {key: "" for key in headings}
    if not text:
      return {}
    pattern = re.compile(r"(Description|Suggested use|Other ingredients|Warnings|Disclaimer)\s*", re.IGNORECASE)
    matches = list(pattern.finditer(text))
    if not matches:
        return {"Description": normalize_text(text)} if normalize_text(text) else {}
    for idx, match in enumerate(matches):
        start = match.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        heading = match.group(1)
        canonical = next((h for h in headings if h.lower() == heading.lower()), heading)
        body = normalize_text(text[start:end])
        if body:
            sections[canonical] = body
    return {key: value for key, value in sections.items() if value}


def parse_images(text):
    return list(dict.fromkeys(re.findall(r"https?://[^\s\"'>]+\.(?:jpg|jpeg|png|webp)", text or "", flags=re.IGNORECASE)))


def parse_title(html):
    match = re.search(r"<title[^>]*>(.*?)</title>", html or "", flags=re.IGNORECASE | re.DOTALL)
    return strip_tags(match.group(1)) if match else None


def normalize_url(value, base_url=None):
    text = normalize_text(value)
    if not text:
        return None
    if text.startswith("//"):
        return f"https:{text}"
    if re.match(r"^https?://", text, flags=re.IGNORECASE):
        return text
    if base_url and not re.match(r"^[a-z]+:", text, flags=re.IGNORECASE):
        return urljoin(base_url, text)
    return None


def looks_like_supplement_facts_asset(url=None, alt=None):
    haystack = " ".join(
        normalize_text(value)
        for value in (alt, url)
        if normalize_text(value)
    ).lower()
    if not haystack:
        return False
    return bool(
        re.search(r"\bsupplement facts?\b", haystack)
        or re.search(r"\bnutrition facts?\b", haystack)
        or re.search(r"(?:^|[_/\-])sf(?:[_./?\-]|$)", haystack)
        or re.search(r"\bfacts?[_\-\s]?square\b", haystack)
    )


def parse_shopify_product_json(html):
    for raw_json in re.findall(
        r"<script[^>]*type=[\"']application/json[\"'][^>]*>(.*?)</script>",
        html or "",
        flags=re.IGNORECASE | re.DOTALL,
    ):
        candidate = normalize_text(raw_json)
        if not candidate or not candidate.startswith("{"):
            continue
        try:
            payload = json.loads(raw_json)
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        if payload.get("handle") and payload.get("title") and (
            payload.get("media") or payload.get("images") or payload.get("variants")
        ):
            return payload
    return None


def extract_pdf_urls(html, base_url=None):
    urls = []
    try:
        doc = lxml_html.fromstring(html)
        for node in doc.xpath("//a[@href] | //iframe[@src] | //embed[@src] | //object[@data]"):
            candidate = (
                node.get("href")
                or node.get("src")
                or node.get("data")
            )
            normalized = normalize_url(candidate, base_url=base_url)
            if normalized and re.search(r"\.pdf(?:[?#].*)?$", normalized, flags=re.IGNORECASE):
                urls.append(normalized)
    except Exception:
        pass

    for match in re.findall(
        r"https?://[^\"'\s>]+\.pdf(?:\?[^\"'\s>]*)?",
        html or "",
        flags=re.IGNORECASE,
    ):
        urls.append(match)
    return unique_list(urls)


def extract_likely_facts_images_from_html(html, base_url=None):
    urls = []
    try:
        doc = lxml_html.fromstring(html)
        for img in doc.xpath("//img"):
            alt = img.get("alt")
            src = normalize_url(
                img.get("src")
                or img.get("data-src")
                or img.get("data-original")
                or img.get("data-lazy-src"),
                base_url=base_url,
            )
            if src and looks_like_supplement_facts_asset(src, alt):
                urls.append(src)
    except Exception:
        pass
    return unique_list(urls)


def extract_shopify_supplement_facts_artifacts(html, base_url=None):
    product = parse_shopify_product_json(html)
    fact_image_urls = []
    shopify_fact_rows = []
    shopify_serving_size = None
    shopify_servings_per_container = None

    if product:
        for media in coerce_list(product.get("media")):
            if not isinstance(media, dict):
                continue
            src = normalize_url(
                media.get("src")
                or (media.get("preview_image") or {}).get("src"),
                base_url=base_url,
            )
            alt = first_text(media.get("alt"))
            if src and looks_like_supplement_facts_asset(src, alt):
                fact_image_urls.append(src)

        for image in coerce_list(product.get("images")):
            src = normalize_url(
                image if isinstance(image, str) else image.get("src"),
                base_url=base_url,
            )
            if src and looks_like_supplement_facts_asset(src):
                fact_image_urls.append(src)

        for html_candidate in (
            product.get("description"),
            product.get("content"),
        ):
            parsed = parse_supplement_facts_rows(str(html_candidate or ""))
            if parsed.get("rows"):
                shopify_fact_rows = parsed.get("rows") or []
                shopify_serving_size = parsed.get("servingSize")
                shopify_servings_per_container = parsed.get("servingsPerContainer")
                break

    fact_image_urls = [
        url for url in unique_list(
            fact_image_urls + extract_likely_facts_images_from_html(html, base_url=base_url)
        )
        if "{width}" not in url
    ]

    return {
        "shopifyProductDetected": bool(product),
        "shopifyHandle": normalize_text(product.get("handle")) if isinstance(product, dict) else None,
        "shopifyTitle": normalize_text(product.get("title")) if isinstance(product, dict) else None,
        "imageUrls": fact_image_urls,
        "pdfUrls": extract_pdf_urls(html, base_url=base_url),
        "shopifyFacts": {
            "servingSize": shopify_serving_size,
            "servingsPerContainer": shopify_servings_per_container,
            "rows": shopify_fact_rows,
        },
    }


def coerce_list(value):
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def coerce_types(value):
    output = []
    for item in coerce_list(value):
        text = normalize_text(item)
        if not text:
            continue
        normalized = re.split(r"[/#]", text)[-1].strip().lower()
        if normalized:
            output.append(normalized)
    return unique_list(output)


def collect_text_candidates(value):
    if value is None:
        return []
    if isinstance(value, (str, int, float, bool)):
        text = normalize_text(value)
        return [text] if text else []
    if isinstance(value, list):
        output = []
        for item in value:
            output.extend(collect_text_candidates(item))
        return unique_list(output)
    if isinstance(value, dict):
        output = []
        for key in ("@value", "name", "title", "headline", "description", "text", "caption"):
            if key in value:
                output.extend(collect_text_candidates(value.get(key)))
        return unique_list(output)
    return []


def first_text(value):
    values = collect_text_candidates(value)
    return values[0] if values else None


def collect_url_candidates(value, base_url=None):
    if value is None:
        return []
    if isinstance(value, (str, int, float)):
        url = normalize_url(value, base_url=base_url)
        return [url] if url else []
    if isinstance(value, list):
        output = []
        for item in value:
            output.extend(collect_url_candidates(item, base_url=base_url))
        return unique_list(output)
    if isinstance(value, dict):
        output = []
        for key in ("url", "contentUrl", "src", "image", "logo", "@id", "item"):
            if key in value:
                output.extend(collect_url_candidates(value.get(key), base_url=base_url))
        return unique_list(output)
    return []


def first_url(value, base_url=None):
    values = collect_url_candidates(value, base_url=base_url)
    return values[0] if values else None


def get_node_value(node, key):
    if not isinstance(node, dict):
        return None
    if key in node:
        return node.get(key)
    props = node.get("properties")
    if isinstance(props, dict) and key in props:
        return props.get(key)
    return None


def iter_metadata_nodes(value, seen=None):
    if seen is None:
        seen = set()
    if isinstance(value, list):
        for item in value:
            yield from iter_metadata_nodes(item, seen)
        return
    if not isinstance(value, dict):
        return
    ident = id(value)
    if ident in seen:
        return
    seen.add(ident)
    yield value
    for child in value.values():
        yield from iter_metadata_nodes(child, seen)


def infer_dosage_form(*values):
    haystack = " ".join(
        normalize_text(item)
        for item in values
        if normalize_text(item)
    )
    if not haystack:
        return None
    for pattern, label in DOSAGE_FORM_PATTERNS:
        if pattern.search(haystack):
            return label
    return None


def parse_open_graph(entries, base_url=None):
    props = {}
    for entry in entries or []:
        for key, value in entry.get("properties", []) if isinstance(entry, dict) else []:
            props.setdefault(key, []).append(value)

    images = collect_url_candidates(props.get("og:image"), base_url=base_url)
    return {
        "title": first_text(props.get("og:title")),
        "description": first_text(props.get("og:description")),
        "type": first_text(props.get("og:type")),
        "url": first_url(props.get("og:url"), base_url=base_url),
        "siteName": first_text(props.get("og:site_name")),
        "images": images,
        "image": images[0] if images else None,
    }


def parse_dublin_core(entries):
    values = {}
    for entry in entries or []:
        for element in entry.get("elements", []) if isinstance(entry, dict) else []:
            name = normalize_text(element.get("name")).lower()
            content = normalize_text(element.get("content"))
            if not name or not content or name in values:
                continue
            values[name] = content
    return {
        "title": values.get("title"),
        "description": values.get("description"),
    }


def extract_breadcrumbs(nodes):
    breadcrumbs = []
    for node in nodes:
        node_types = coerce_types(get_node_value(node, "@type") or get_node_value(node, "type"))
        if "breadcrumblist" not in node_types:
            continue
        items = coerce_list(get_node_value(node, "itemListElement"))
        for item in items:
            name = first_text(get_node_value(item, "name") if isinstance(item, dict) else item)
            if not name and isinstance(item, dict):
                name = first_text(get_node_value(get_node_value(item, "item"), "name"))
            if name:
                breadcrumbs.append(name)
    return unique_list(breadcrumbs)


def build_product_summary(node, base_url=None):
    name = first_text(get_node_value(node, "name")) or first_text(get_node_value(node, "headline"))
    brand = (
        first_text(get_node_value(get_node_value(node, "brand"), "name"))
        or first_text(get_node_value(node, "brand"))
        or first_text(get_node_value(get_node_value(node, "manufacturer"), "name"))
        or first_text(get_node_value(node, "manufacturer"))
    )
    category_values = unique_list(
        collect_text_candidates(get_node_value(node, "category"))
        + collect_text_candidates(get_node_value(node, "keywords"))
    )
    images = collect_url_candidates(get_node_value(node, "image"), base_url=base_url)
    product_url = first_url(get_node_value(node, "url"), base_url=base_url) or first_url(
        get_node_value(node, "mainEntityOfPage"),
        base_url=base_url,
    )
    gtin = (
        first_text(get_node_value(node, "gtin14"))
        or first_text(get_node_value(node, "gtin13"))
        or first_text(get_node_value(node, "gtin12"))
        or first_text(get_node_value(node, "gtin8"))
        or first_text(get_node_value(node, "gtin"))
    )
    return {
        "name": name,
        "brand": brand,
        "description": first_text(get_node_value(node, "description")),
        "category": category_values[0] if category_values else None,
        "categories": category_values,
        "images": images,
        "image": images[0] if images else None,
        "sku": first_text(get_node_value(node, "sku")),
        "gtin": gtin,
        "url": product_url,
    }


def score_product_summary(summary):
    if not summary:
        return -1
    score = 0
    if summary.get("name"):
        score += 10
    if summary.get("brand"):
        score += 4
    if summary.get("description"):
        score += 2
    if summary.get("category"):
        score += 2
    if summary.get("images"):
        score += 4
    if summary.get("gtin"):
        score += 10
    if summary.get("url"):
        score += 2
    return score


def parse_structured_metadata(html, base_url=None):
    if not html:
        return {
            "available": extruct is not None,
            "detectedKinds": [],
            "primaryProduct": None,
            "openGraph": None,
            "dublinCore": None,
            "breadcrumbs": [],
        }

    if extruct is None or get_base_url is None:
        return {
            "available": False,
            "detectedKinds": [],
            "primaryProduct": None,
            "openGraph": None,
            "dublinCore": None,
            "breadcrumbs": [],
        }

    resolved_base_url = base_url or get_base_url(html, base_url or "")
    extracted = extruct.extract(
        html,
        base_url=resolved_base_url,
        syntaxes=["json-ld", "microdata", "opengraph", "dublincore"],
    )
    detected_kinds = [key for key in ("json-ld", "microdata", "opengraph", "dublincore") if extracted.get(key)]
    metadata_nodes = list(iter_metadata_nodes(extracted.get("json-ld", []))) + list(iter_metadata_nodes(extracted.get("microdata", [])))

    product_summaries = []
    for node in metadata_nodes:
        node_types = coerce_types(get_node_value(node, "@type") or get_node_value(node, "type"))
        if "product" not in node_types and "dietarysupplement" not in node_types:
            continue
        product_summaries.append(build_product_summary(node, base_url=resolved_base_url))

    primary_product = None
    if product_summaries:
        primary_product = max(product_summaries, key=score_product_summary)
        primary_product["dosageForm"] = infer_dosage_form(
            primary_product.get("name"),
            primary_product.get("category"),
            " ".join(primary_product.get("categories") or []),
        )

    open_graph = parse_open_graph(extracted.get("opengraph", []), base_url=resolved_base_url)
    if not any(open_graph.values()):
        open_graph = None
    dublin_core = parse_dublin_core(extracted.get("dublincore", []))
    if not any(dublin_core.values()):
        dublin_core = None

    return {
        "available": True,
        "detectedKinds": detected_kinds,
        "primaryProduct": primary_product,
        "openGraph": open_graph,
        "dublinCore": dublin_core,
        "breadcrumbs": extract_breadcrumbs(metadata_nodes),
    }


def parse_sections_from_html(html):
    headings = ["Description", "Suggested use", "Other ingredients", "Warnings", "Disclaimer"]
    sections = {}

    if not html:
        return sections

    try:
        doc = lxml_html.fromstring(html)
        heading_lookup = {heading.lower(): heading for heading in headings}

        # Newer iHerb product pages place overview content inside a details-info
        # block where each section is a <div> with an <h3><strong>Heading</strong>.
        for node in doc.xpath('//div[contains(@class, "details-info")]/*[self::div or self::section]'):
            heading_text = normalize_text(" ".join(node.xpath('.//h3[1]//strong[1]//text()')))
            if not heading_text:
                continue
            canonical = heading_lookup.get(heading_text.lower())
            if not canonical:
                continue
            body_parts = node.xpath('./div[1]//text() | ./p//text()')
            body = normalize_text(" ".join(body_parts))
            if body:
                sections[canonical] = body

        if sections:
            return sections
    except Exception:
        sections = {}

    pattern = re.compile(
        r"<h3[^>]*>\s*<strong[^>]*>\s*(Description|Suggested use|Other ingredients|Warnings|Disclaimer)\s*</strong>\s*</h3>\s*"
        r"<div[^>]*class=\"([^\"]*(?:prodOverviewDetail|prodOverviewIngred|prodOverviewWarn)[^\"]*)\"[^>]*>(.*?)</div>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for match in pattern.finditer(html or ""):
        heading = normalize_text(match.group(1))
        body = strip_tags(match.group(3))
        if body:
            sections[heading] = body
    return sections


def parse_supplement_facts_rows(html):
    table_match = re.search(
        r"<table[^>]*>(.*?)</table>",
        html or "",
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not table_match or "supplement facts" not in table_match.group(1).lower():
        return {
            "servingSize": None,
            "servingsPerContainer": None,
            "rows": [],
        }

    rows = []
    serving_size = None
    servings_per_container = None
    table_html = table_match.group(1)
    for row_html in re.findall(r"<tr[^>]*>(.*?)</tr>", table_html, flags=re.IGNORECASE | re.DOTALL):
        cells = [
            strip_tags(cell_html)
            for cell_html in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.IGNORECASE | re.DOTALL)
        ]
        cells = [cell for cell in cells if cell]
        if not cells:
            continue
        joined = " ".join(cells)
        lower = joined.lower()
        if "supplement facts" in lower:
            continue
        if "serving size" in lower:
            serving_size = normalize_text(joined.split(":", 1)[-1])
            continue
        if "servings per container" in lower:
            servings_per_container = normalize_text(joined.split(":", 1)[-1])
            continue
        if "amount per serving" in lower and "%daily value" in lower:
            continue
        if "daily value" in lower and len(cells) == 1:
            continue
        substancy = cells[0] if len(cells) >= 1 else None
        amount = cells[1] if len(cells) >= 2 else None
        daily_value = cells[2] if len(cells) >= 3 else None
        if substancy or amount or daily_value:
            rows.append(
                {
                    "substancy": substancy,
                    "amountPerServing": amount,
                    "dailyValuePercent": daily_value,
                },
            )
    return {
        "servingSize": serving_size,
        "servingsPerContainer": servings_per_container,
        "rows": rows,
    }


def scrape_with_scrapling(url, mode, headless, network_idle, allow_google_search):
    from scrapling.fetchers import Fetcher

    fetch_kwargs = {}
    header_strategy = "default_stealthy_headers"
    stealthy_headers = True

    # Codeage official product pages redirect to the locale home page when Scrapling's
    # Google-style referer/browser header bundle is present. Use a quieter static request
    # shape for those product URLs so we keep the product HTML for downstream metadata parsing.
    if is_codeage_official_product_url(url):
        stealthy_headers = False
        header_strategy = "codeage_no_google_referer"
        fetch_kwargs["headers"] = {
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        }

    page = Fetcher.get(url, stealthy_headers=stealthy_headers, **fetch_kwargs)
    fetcher = "Fetcher"
    effective_mode = "plain"

    html = (
        getattr(page, "html_content", None)
        or getattr(page, "html", None)
        or getattr(page, "text", None)
        or getattr(page, "content", None)
        or str(page)
    )
    text = normalize_text(
        getattr(page, "text", None)
        or getattr(page, "body_text", None)
        or html
    )
    title = normalize_text(getattr(page, "title", None))
    final_url = normalize_text(getattr(page, "url", None) or url)
    return {
        "fetcher": fetcher,
        "effectiveMode": effective_mode,
        "headerStrategy": header_strategy,
        "html": html,
        "text": text,
        "title": title or None,
        "finalUrl": final_url or url,
    }


def main():
    payload = json.loads(sys.stdin.read() or "{}")
    url = payload.get("url")
    mode = payload.get("mode", "stealthy")
    headless = bool(payload.get("headless", True))
    network_idle = bool(payload.get("networkIdle", True))
    allow_google_search = bool(payload.get("allowGoogleSearch", False))

    if not url:
        print(json.dumps({"ok": False, "errorCode": "missing_url"}))
        return

    try:
        result = scrape_with_scrapling(url, mode, headless, network_idle, allow_google_search)
        sections = parse_sections_from_html(result["html"]) or parse_sections(result["text"])
        facts = parse_supplement_facts_rows(result["html"])
        supplement_facts_artifacts = extract_shopify_supplement_facts_artifacts(
            result["html"],
            base_url=result["finalUrl"],
        )
        supplement_facts_source = "html_table" if facts.get("rows") else None
        shopify_facts = supplement_facts_artifacts.get("shopifyFacts") or {}
        if not facts.get("rows") and shopify_facts.get("rows"):
            facts = {
                "servingSize": shopify_facts.get("servingSize"),
                "servingsPerContainer": shopify_facts.get("servingsPerContainer"),
                "rows": shopify_facts.get("rows") or [],
            }
            supplement_facts_source = "shopify_json_description"
        metadata = parse_structured_metadata(result["html"], base_url=result["finalUrl"])
        metadata_product = metadata.get("primaryProduct") or {}
        metadata_og = metadata.get("openGraph") or {}
        images = unique_list(
            parse_images(result["html"])
            + (metadata_product.get("images") or [])
            + (metadata_og.get("images") or [])
        )
        body_text = normalize_text(strip_tags(result["html"])[:20000])
        categories = unique_list(
            metadata.get("breadcrumbs", [])
            + (metadata_product.get("categories") or [])
        )
        resolved_title = (
            result["title"]
            or parse_title(result["html"])
            or metadata_product.get("name")
            or metadata_og.get("title")
            or (metadata.get("dublinCore") or {}).get("title")
        )
        dosage_form = infer_dosage_form(
            resolved_title,
            " ".join(categories),
            metadata_product.get("category"),
        )
        output = {
            "ok": True,
            "fetcher": result["fetcher"],
            "mode": mode,
            "effectiveMode": result["effectiveMode"],
            "headerStrategy": result.get("headerStrategy"),
            "url": url,
            "pageUrl": result["finalUrl"],
            "finalUrl": result["finalUrl"],
            "title": resolved_title,
            "bodyText": body_text,
            "sections": sections,
            "servingSize": facts["servingSize"],
            "servingsPerContainer": facts["servingsPerContainer"],
            "supplementFactsRows": facts["rows"],
            "supplementFactsSource": supplement_facts_source,
            "supplementFactsArtifacts": supplement_facts_artifacts,
            "structuredMetadata": metadata,
            "categories": categories,
            "dosageForm": dosage_form,
            "images": images,
            "primaryImage": images[0] if images else None,
            "extractionWarnings": [
                *([f"requested_{mode}_mode_downgraded_to_plain"] if result["effectiveMode"] != mode else []),
                *(["structured_metadata_unavailable"] if not metadata.get("available") else []),
                *(["missing_sections"] if not sections else []),
                *(["missing_supplement_facts_rows"] if not facts["rows"] else []),
            ],
            "dynamicResolved": False,
            "blocked": False,
        }
        print(json.dumps(output))
    except ModuleNotFoundError as exc:
        print(json.dumps({
            "ok": False,
            "errorCode": "scrapling_not_installed",
            "message": str(exc),
        }))
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "errorCode": "scrapling_fetch_failed",
            "message": str(exc),
        }))


if __name__ == "__main__":
    main()
