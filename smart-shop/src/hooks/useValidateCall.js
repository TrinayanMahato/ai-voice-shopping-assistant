import { useState, useEffect, useMemo, useRef } from 'react';

// Both proxied to d2capis (see vite.config.js '/cart/api' -> local d2capis / d2capis.chqme.com).
const GENERATE_SESSION_URL = '/cart/api/chqme/generate_ai_session';
const VALIDATE_URL = 'https://smartshop.chqme.com/xai/validate_call_token';

/**
 * useValidateCall
 *
 * URL carries the *user's* session, not a call token yet:
 *   /?token=<user_access_token>&shop=<shop_name>
 *
 * Two calls run before anything is "ready" (both against d2capis):
 *   1. generate_ai_session — exchanges access_token + shop for a fresh
 *      ai_call_token (this mints the ai_tokens/ai_orders rows).
 *   2. validate_call_token — confirms that ai_call_token against ai_orders,
 *      the same way generate_meeting_token will re-check it later.
 *
 * Phase flow: 'validating' → 'ready' | 'denied' | 'error'
 * The caller advances phase further (joining → connected).
 */
export function useValidateCall({ enabled = true } = {}) {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);

  // ── Phase ─────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState('validating');
  const [errMsg, setErrMsg] = useState('');

  // ── Identity fields (populated after successful validation) ───────────────
  const [callToken, setCallToken] = useState('');
  const [userName, setUserName] = useState('');
  const [meetingDetails, setMeetingDetails] = useState({});
  const [sellerConfig, setSellerConfig] = useState(null);

  // generate_ai_session mints a real DB row (ai_tokens + ai_orders) on every
  // call, so this effect must fire its network calls at most once per mount —
  // a `cancelled` flag alone only guards setState, not the fetch itself. This
  // ref makes the guard survive React's dev-mode double-invoke and Vite HMR
  // remounts, not just re-renders.
  const hasStartedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (hasStartedRef.current) return;
    hasStartedRef.current = true;

    const accessToken = searchParams.get('token');
    const shop = searchParams.get('shop');

    // Extract product_id from URL — take everything after the last '/'
    const rawProductId = searchParams.get('product_id');
    const productId = rawProductId ? rawProductId.split('/').filter(Boolean).pop() : null;
    if (productId) {
      try { sessionStorage.setItem('product_id', productId); } catch (e) { }
      console.log('[useValidateCall] product_id extracted:', productId);
    }

    if (!accessToken) {
      setErrMsg('Missing token in the URL.');
      setPhase('error');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // ── Validate the call token directly ────────────────────
        const res = await fetch(VALIDATE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: accessToken }),
        });
        const data = await res.json();
        if (cancelled) return;

        if (data.status_code === 0) {
          const details = (data.return_data || [])[0] || {};

          setCallToken(details.ai_call_token || accessToken);
          setMeetingDetails(details);
          setUserName(details.first_name || 'Guest');

          if (details.product_id) {
            try { sessionStorage.setItem('product_id', details.product_id); } catch (e) { }
          }
          if (details.ai_id) {
            try { sessionStorage.setItem('ai_id', details.ai_id); } catch (e) { }
          }
          if (details.ai_call_token) {
            try { sessionStorage.setItem('ai_call_token', details.ai_call_token); } catch (e) { }
          }

          // Fetch Seller Data
          let fetchedSellerConfig = null;
          if (details.seller_id) {
            try {
              const sellerRes = await fetch(`https://smartshop.chqme.com/xai/api/get_seller_data?seller_id=${details.seller_id}`);
              const sellerData = await sellerRes.json();
              let sData = sellerData.return_data;
              if (Array.isArray(sData)) {
                sData = sData[0];
              }
              if (sData && sData.logo_url !== undefined) {
                fetchedSellerConfig = sData;
                setSellerConfig(sData);
              }
            } catch (err) {
              console.warn('[useValidateCall] Failed to fetch seller data:', err);
            }
          }

          sessionStorage.setItem('validate_token_response', JSON.stringify(data));
          if (fetchedSellerConfig) {
            sessionStorage.setItem('seller_config', JSON.stringify(fetchedSellerConfig));
          }

          setPhase('ready');
        } else if (data.status_code === -1) {
          setErrMsg(data.status_msg || 'This call link is no longer valid.');
          setPhase('denied');
        } else {
          setErrMsg(data.status_msg || 'Failed to validate token.');
          setPhase('error');
        }
      } catch (err) {
        if (!cancelled) {
          setErrMsg('An error occurred while validating the call.');
          setPhase('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [searchParams]);

  return {
    // Phase — caller advances this further (joining → connected)
    phase,
    setPhase,
    errMsg,
    setErrMsg,

    // Identity fields
    callToken,
    userName,
    setUserName,
    meetingDetails,
    setMeetingDetails,
    sellerConfig,
  };
}
