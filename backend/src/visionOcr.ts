/**
 * Google Cloud Vision OCR Integration
 * Calls DOCUMENT_TEXT_DETECTION and outputs Token[] for post-processing
 */

import { ImageAnnotatorClient, protos } from '@google-cloud/vision';

// ============================================================================
// TYPES
// ============================================================================

export interface BoundingBox {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
}

export interface Token {
    text: string;
    bbox: BoundingBox;
    confidence: number;
    height: number;
    xMin: number;
    yCenter: number;
}

export interface VisionOcrInput {
    imageBase64?: string;
    imageUrl?: string;
}

export interface VisionOcrResult {
    tokens: Token[];
    fullText: string;
    rawResponse?: protos.google.cloud.vision.v1.IAnnotateImageResponse;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS ?? 10000);
const MAX_RETRIES = 1;

// Initialize Vision client using Service Account
// Expects GOOGLE_APPLICATION_CREDENTIALS env var or GOOGLE_VISION_SA_JSON
let visionClient: ImageAnnotatorClient | null = null;

function getVisionClient(): ImageAnnotatorClient {
    if (visionClient) {
        return visionClient;
    }

    const saJson = process.env.GOOGLE_VISION_SA_JSON;
    if (saJson) {
        try {
            const credentials = JSON.parse(saJson);
            visionClient = new ImageAnnotatorClient({ credentials });
        } catch (e) {
            console.error('[Vision] Failed to parse GOOGLE_VISION_SA_JSON:', e);
            throw new Error('Invalid GOOGLE_VISION_SA_JSON configuration');
        }
    } else {
        // Falls back to GOOGLE_APPLICATION_CREDENTIALS file path
        visionClient = new ImageAnnotatorClient();
    }

    return visionClient;
}

// ============================================================================
// VISION API CALL
// ============================================================================

async function callVisionWithTimeout(
    input: VisionOcrInput,
    timeoutMs: number
): Promise<protos.google.cloud.vision.v1.IAnnotateImageResponse> {
    const client = getVisionClient();

    // P0-1: Use batchAnnotateImages with gax timeout option
    // Helper methods (documentTextDetection) don't support gax options as second param
    const request: protos.google.cloud.vision.v1.IBatchAnnotateImagesRequest = {
        requests: [{
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            image: {},
        }],
    };

    if (input.imageBase64) {
        // P0: Ensure content is Buffer (supports both base64 string and dataURL)
        const raw = input.imageBase64.replace(/^data:.*;base64,/, '');
        const buffer = Buffer.from(raw, 'base64');
        request.requests![0].image = { content: buffer };
    } else if (input.imageUrl) {
        request.requests![0].image = { source: { imageUri: input.imageUrl } };
    } else {
        throw new Error('Either imageBase64 or imageUrl must be provided');
    }

    // Gax timeout option for the actual RPC call
    const gaxOptions = { timeout: timeoutMs };

    // Promise.race as additional fallback
    const visionCall = async () => {
        const [response] = await client.batchAnnotateImages(request, gaxOptions);
        if (!response.responses || response.responses.length === 0) {
            throw new Error('Empty response from Vision API');
        }
        return response.responses[0];
    };

    const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Vision OCR timeout after ${timeoutMs}ms`)), timeoutMs + 1000);
    });

    return Promise.race([visionCall(), timeoutPromise]);
}

/**
 * Call Google Vision DOCUMENT_TEXT_DETECTION with timeout and retry
 */
export async function callVisionOcr(input: VisionOcrInput): Promise<VisionOcrResult> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const response = await callVisionWithTimeout(input, VISION_TIMEOUT_MS);
            return parseVisionResponse(response);
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const isRetryable =
                lastError.message.includes('ETIMEDOUT') ||
                lastError.message.includes('ECONNRESET') ||
                lastError.message.includes('503') ||
                lastError.message.includes('500') ||
                lastError.message.includes('aborted');

            if (!isRetryable || attempt >= MAX_RETRIES) {
                break;
            }

            console.warn(`[Vision] Retry ${attempt + 1}/${MAX_RETRIES} after error:`, lastError.message);
            await sleep(500 * (attempt + 1)); // Exponential backoff
        }
    }

    throw lastError ?? new Error('Vision OCR failed');
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

/**
 * Parse Vision response into Token[] structure for post-processing
 * Vision returns: Page → Block → Paragraph → Word → Symbol + bounding boxes
 */
export function parseVisionResponse(
    response: protos.google.cloud.vision.v1.IAnnotateImageResponse
): VisionOcrResult {
    const tokens: Token[] = [];
    const fullTextAnnotation = response.fullTextAnnotation;

    if (!fullTextAnnotation?.pages?.length) {
        return {
            tokens: [],
            fullText: response.textAnnotations?.[0]?.description ?? '',
            rawResponse: response,
        };
    }

    for (const page of fullTextAnnotation.pages) {
        for (const block of page.blocks ?? []) {
            for (const paragraph of block.paragraphs ?? []) {
                for (const word of paragraph.words ?? []) {
                    const wordText = (word.symbols ?? [])
                        .map((s) => s.text ?? '')
                        .join('');

                    if (!wordText.trim()) continue;

                    const vertices = word.boundingBox?.vertices ?? [];
                    if (vertices.length < 4) continue;

                    // P1-7: Skip tokens with missing coordinates instead of defaulting to 0
                    const hasValidCoords = vertices.every(
                        (v) => v.x !== undefined && v.x !== null && v.y !== undefined && v.y !== null
                    );
                    if (!hasValidCoords) continue;

                    const xs = vertices.map((v) => v.x as number);
                    const ys = vertices.map((v) => v.y as number);

                    const bbox: BoundingBox = {
                        xMin: Math.min(...xs),
                        xMax: Math.max(...xs),
                        yMin: Math.min(...ys),
                        yMax: Math.max(...ys),
                    };

                    const height = bbox.yMax - bbox.yMin;
                    const yCenter = (bbox.yMin + bbox.yMax) / 2;

                    // Word-level confidence
                    const confidence = word.confidence ?? 0.9;

                    tokens.push({
                        text: wordText,
                        bbox,
                        confidence,
                        height,
                        xMin: bbox.xMin,
                        yCenter,
                    });
                }
            }
        }
    }

    return {
        tokens,
        fullText: fullTextAnnotation.text ?? '',
        rawResponse: response,
    };
}

// ============================================================================
// UTILS
// ============================================================================

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
