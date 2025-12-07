import { useEffect, useRef, useState } from 'react';
import RNEventSource from 'react-native-sse';

// Define the shape of our partial analysis
type AnalysisState = {
    productInfo: any | null;
    efficacy: any | null;
    safety: any | null;
    usage: any | null;
    value: any | null;
    social: any | null;
    meta: any | null;
    status: 'idle' | 'loading' | 'streaming' | 'complete' | 'error';
    error: string | null;
};

export function useStreamAnalysis(barcode: string) {
    const [state, setState] = useState<AnalysisState>({
        productInfo: null,
        efficacy: null,
        safety: null,
        usage: null,
        value: null,
        social: null,
        meta: null,
        status: 'idle',
        error: null,
    });

    const eventSourceRef = useRef<RNEventSource | null>(null);

    useEffect(() => {
        if (!barcode) return;

        setState(prev => ({ ...prev, status: 'loading', error: null }));

        // Replace with your actual backend URL
        const API_URL = 'http://192.168.1.68:3001';

        // Initialize SSE connection (POST method)
        const es = new RNEventSource(`${API_URL}/api/enrich-stream`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ barcode }),
        });

        eventSourceRef.current = es;

        // Listeners
        es.addEventListener('open', () => {
            console.log('[SSE] Connection Opened');
            setState(prev => ({ ...prev, status: 'streaming' }));
        });

        es.addEventListener('message', (event) => {
            // Although we use custom events, standard message listener is good for debugging
            // or if backend sends standard messages.
        });

        // 1. Product Info (Immediate)
        es.addEventListener('product_info' as any, (event: any) => {
            const data = JSON.parse(event.data);
            console.log('[SSE] Received Product Info');
            setState(prev => ({
                ...prev,
                productInfo: data.productInfo,
                // If you need sources separately, store them too
            }));
        });

        // 2. Efficacy Result
        es.addEventListener('result_efficacy' as any, (event: any) => {
            const data = JSON.parse(event.data);
            console.log('[SSE] Received Efficacy');
            setState(prev => ({ ...prev, efficacy: data }));
        });

        // 3. Safety Result
        es.addEventListener('result_safety' as any, (event: any) => {
            const data = JSON.parse(event.data);
            console.log('[SSE] Received Safety');
            setState(prev => ({ ...prev, safety: data }));
        });

        // 4. Usage/Value Result
        es.addEventListener('result_usage' as any, (event: any) => {
            const data = JSON.parse(event.data);
            console.log('[SSE] Received Usage');
            setState(prev => ({
                ...prev,
                usage: data.usage,
                value: data.value,
                social: data.social,
            }));
        });

        // 5. Completion
        es.addEventListener('done' as any, () => {
            console.log('[SSE] Done');
            setState(prev => ({ ...prev, status: 'complete' }));
            es.close();
        });

        // 6. Error
        es.addEventListener('error', (event: any) => {
            console.error('[SSE] Error:', event);
            // Backend sends error events with type 'error' usually, 
            // but connection errors also trigger this.
            if (event.type === 'error' && event.data) {
                const errorData = JSON.parse(event.data);
                setState(prev => ({ ...prev, status: 'error', error: errorData.message || 'Scan failed' }));
            } else if (event.type === 'error') {
                // Network error usually
                // setState(prev => ({ ...prev, status: 'error', error: 'Connection failed' }));
            }
            es.close();
        });

        return () => {
            es.removeAllEventListeners();
            es.close();
        };
    }, [barcode]);

    return state;
}
