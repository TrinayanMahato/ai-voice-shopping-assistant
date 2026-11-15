import { useState, useRef, useCallback, useEffect } from 'react';
import { extractPhone, extractOtp, maskPhone } from '../utils/parseAuth';

const LOGIN_OTP_URL = '/cart/api/chqme/login_otp';
const VALIDATE_OTP_URL = '/cart/api/chqme/validate_otp';

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// Shared payload scaffold — mirrors the original JoinDialog requests so the
// backend contract is unchanged (only mobileno / otp vary).
const basePayload = { name: '', email: '', shop: 'string', seller_id: 0, product_id: [0], utm_data: 'string' };

// Opening line = the store's welcome_text (falls back to a plain prompt).
const DEFAULT_GREETING = '👋 Welcome! Please enter your mobile number to continue.';
const makeGreeting = (welcomeText) => ([
  { sender: 'agent', text: (welcomeText && welcomeText.trim()) || DEFAULT_GREETING, time: nowLabel() },
]);

export function useAuthFlow({ onVerified, welcomeText = '' }) {
  const [step, setStep] = useState('phone');
  const [messages, setMessages] = useState(() => makeGreeting(welcomeText));
  const [busy, setBusy] = useState(false);
  const mobileRef = useRef('');
  const touchedRef = useRef(false);   // true once the user has sent anything

  const pushAgent = (text) => setMessages((m) => [...m, { sender: 'agent', text, time: nowLabel() }]);
  const pushUser = (text) => setMessages((m) => [...m, { sender: 'user', text, time: nowLabel() }]);

  // welcome_text loads async (after first paint). Refresh the opening message
  // when it arrives — but only until the user has started, so an in-progress
  // conversation is never clobbered.
  useEffect(() => {
    if (touchedRef.current) return;
    setMessages(makeGreeting(welcomeText));
  }, [welcomeText]);

  // (Re)seed the conversation — called whenever a call ends, to re-arm for the next one.
  const seed = useCallback(() => {
    touchedRef.current = false;
    setStep('phone');
    setBusy(false);
    mobileRef.current = '';
    setMessages(makeGreeting(welcomeText));
  }, [welcomeText]);

  const requestOtp = async (mobile) => {
    setBusy(true);
    try {
      const res = await fetch(LOGIN_OTP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...basePayload, mobileno: mobile, otp: '' }),
      });
      const data = await res.json();
      if (data.status_msg === 'All OK') {
        mobileRef.current = mobile;
        setStep('otp');
        pushAgent(`Great — I've sent a 6-digit OTP to ${maskPhone(mobile)}. Please type it here to verify.`);
      } else {
        pushAgent("I couldn't send an OTP to that number. Please re-enter your mobile number.");
      }
    } catch {
      pushAgent('Network hiccup while sending the OTP. Please try your mobile number again.');
    }
    setBusy(false);
  };

  const verifyOtp = async (otp) => {
    setBusy(true);
    setStep('verifying');
    try {
      const res = await fetch(VALIDATE_OTP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...basePayload, mobileno: mobileRef.current, otp }),
      });
      const data = await res.json();
      const rd = (data.status_msg === 'All OK' && data.return_data && data.return_data[0]) || null;
      const aiToken = rd?.ai_access_token;
      if (rd && aiToken) {
        const name = rd.name ?? rd.customer_name ?? rd.customerName ?? rd.full_name
          ?? rd.fullname ?? rd.user_name ?? rd.username ?? '';
        pushAgent(name ? `You're verified, ${name}! Connecting you now…` : "You're verified! Connecting you now…");
        setStep('verified');
        onVerified(rd.ai_call_token ?? rd.aiCallToken ?? '', aiToken, {
          seller_id: rd.seller_id ?? rd.sellerId ?? 0,
          shop: rd.shop ?? rd.shop_name ?? rd.store ?? '',
          customerName: name,
          ai_id: rd.ai_id ?? rd.aiId ?? rd.ai_agent_id ?? null,
          ai_call_token: rd.ai_call_token ?? rd.aiCallToken ?? '',
        });
        setBusy(false);
        return;
      }
      pushAgent(aiToken === undefined && rd
        ? 'Verification succeeded but the session token was missing. Please try again.'
        : "That OTP doesn't match. Please re-enter the OTP.");
      setStep('otp');
    } catch {
      pushAgent('Network hiccup while verifying. Please re-enter the OTP.');
      setStep('otp');
    }
    setBusy(false);
  };

  // Feed a raw line from the transcript input.
  const submit = (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed || busy || step === 'verifying' || step === 'verified') return;
    touchedRef.current = true;
    pushUser(trimmed);
    if (step === 'phone') {
      const phone = extractPhone(trimmed);
      if (!phone) { pushAgent("Hmm, that doesn't look like a valid 10-digit mobile number. Please try again."); return; }
      requestOtp(phone);
    } else if (step === 'otp') {
      const otp = extractOtp(trimmed);
      if (!otp) { pushAgent("I couldn't spot the OTP in there. Please type the digits you received."); return; }
      verifyOtp(otp);
    }
  };

  return { step, messages, busy, seed, submit };
}
