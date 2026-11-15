import { useState, useEffect } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// JoinDialog — centered modal collecting mobile → OTP.
//
// Rendered on top of the (blurred) demo/meeting screen while the user is not yet
// connected. Non-dismissible: verification is required before the call connects.
// On successful OTP validation it calls onJoin(callToken, aiToken, storeInfo),
// where callToken is the `ai_call_token` returned by validate_otp.
// ─────────────────────────────────────────────────────────────────────────────
export default function JoinDialog({ onJoin, errMsg, isJoining }) {
  const [mobileNo, setMobileNo] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState('mobile'); // 'mobile' | 'otp'
  const [localErrMsg, setLocalErrMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    if (countdown > 0) {
      const timer = setInterval(() => setCountdown(c => c - 1), 1000);
      return () => clearInterval(timer);
    }
  }, [countdown]);

  const handleMobileSubmit = async (e) => {
    e.preventDefault();
    if (!mobileNo.trim()) return;
    setLocalErrMsg('');
    setIsLoading(true);
    try {
      const res = await fetch('/cart/api/chqme/login_otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobileno: mobileNo,
          otp: "",
          name: "",
          email: "",
          shop: "string",
          seller_id: 0,
          product_id: [0],
          utm_data: "string"
        })
      });
      const data = await res.json();
      if (data.status_msg === "All OK") {
        setStep('otp');
        setCountdown(60);
      } else {
        setLocalErrMsg("User not validated");
      }
    } catch (err) {
      setLocalErrMsg("Network error, please try again.");
    }
    setIsLoading(false);
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    if (!otp.trim()) return;
    setLocalErrMsg('');
    setIsLoading(true);
    try {
      const res = await fetch('/cart/api/chqme/validate_otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mobileno: mobileNo,
          otp: otp,
          name: "",
          email: "",
          shop: "string",
          seller_id: 0,
          product_id: [0],
          utm_data: "string"
        })
      });
      const data = await res.json();
      if (data.status_msg === "All OK" && data.return_data && data.return_data[0]) {
        const rd = data.return_data[0];
        const aiToken = rd.ai_access_token;
        if (aiToken) {
          onJoin(rd.ai_call_token ?? rd.aiCallToken ?? '', aiToken, {
            seller_id: rd.seller_id ?? rd.sellerId ?? 0,
            shop: rd.shop ?? rd.shop_name ?? rd.store ?? '',
            customerName: rd.name ?? rd.customer_name ?? rd.customerName ?? rd.full_name ?? rd.fullname ?? rd.user_name ?? rd.username ?? '',
            ai_id: rd.ai_id ?? rd.aiId ?? rd.ai_agent_id ?? null,
            ai_call_token: rd.ai_call_token ?? rd.aiCallToken ?? '',
          });
        } else {
          setLocalErrMsg("Invalid or missing access token in response.");
        }
      } else {
        setLocalErrMsg("Invalid OTP");
      }
    } catch (err) {
      setLocalErrMsg("Network error, please try again.");
    }
    setIsLoading(false);
  };

  const card = 'relative bg-white border border-gray-200 rounded-[24px] px-[44px] py-[44px] w-full max-w-[440px] shadow-[0_24px_60px_rgba(0,0,0,0.28)] animate-fadein';

  const displayError = localErrMsg || errMsg;
  const isComponentLoading = isLoading || isJoining;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[1rem] bg-black/45 backdrop-blur-md">
      <div className={card}>
        {step === 'otp' && !isComponentLoading && (
          <button
            type="button"
            onClick={() => { setStep('mobile'); setLocalErrMsg(''); }}
            title="Back"
            className="absolute left-[20px] top-[22px] w-[32px] h-[32px] rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        <div className="flex flex-col items-center mb-[36px]">
          <div className="w-[52px] h-[52px] rounded-[14px] bg-gradient-to-br from-indigo-500 to-indigo-600 flex items-center justify-center shadow-lg mb-[18px]">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
          </div>
          <h1 className="text-[22px] font-extrabold text-gray-900 tracking-[-0.02em] text-center">Join the Demo</h1>
          <p className="mt-[6px] text-[13px] text-gray-500 text-center">
            {step === 'mobile' && 'Enter your mobile number to verify'}
            {step === 'otp' && 'Enter the OTP sent to your mobile'}
          </p>
        </div>

        {step === 'mobile' && (
          <form onSubmit={handleMobileSubmit} className="flex flex-col gap-[16px]">
            <div className="flex flex-col gap-[8px]">
              <label htmlFor="mobile-input" className="text-[12px] font-semibold text-gray-500 uppercase tracking-[0.06em]">
                Mobile Number
              </label>
              <div className="relative">
                <span className="absolute left-[14px] top-1/2 -translate-y-1/2 text-gray-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                </span>
                <input
                  id="mobile-input"
                  type="text"
                  value={mobileNo}
                  onChange={(e) => setMobileNo(e.target.value)}
                  placeholder="Enter your mobile number"
                  required
                  autoFocus
                  disabled={isComponentLoading}
                  className="w-full bg-gray-50 border border-gray-300 rounded-[12px] pl-[42px] pr-[16px] py-[14px] text-gray-900 text-[14px] font-medium placeholder-gray-400 outline-none transition-all duration-200 focus:border-indigo-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isComponentLoading || !mobileNo.trim()}
              className="mt-[8px] flex items-center justify-center gap-[10px] w-full py-[16px] px-[28px] rounded-[14px] border-none bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-white text-[15px] font-bold cursor-pointer transition-all duration-200 shadow-[0_4px_20px_rgba(99,102,241,0.35)] hover:-translate-y-[2px] hover:shadow-[0_8px_28px_rgba(99,102,241,0.5)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {isComponentLoading ? (
                <>
                  <div className="w-[18px] h-[18px] rounded-full border-[2.5px] border-[rgba(255,255,255,0.25)] border-t-white animate-spin-fast" />
                  Verifying...
                </>
              ) : (
                'Send OTP'
              )}
            </button>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={handleOtpSubmit} className="flex flex-col gap-[16px]">
            <div className="flex flex-col gap-[8px]">
              <label htmlFor="otp-input" className="text-[12px] font-semibold text-gray-500 uppercase tracking-[0.06em]">
                Enter OTP
              </label>
              <div className="relative">
                <span className="absolute left-[14px] top-1/2 -translate-y-1/2 text-gray-400">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                </span>
                <input
                  id="otp-input"
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="Enter the 6-digit OTP"
                  required
                  autoFocus
                  disabled={isComponentLoading}
                  className="w-full bg-gray-50 border border-gray-300 rounded-[12px] pl-[42px] pr-[16px] py-[14px] text-gray-900 text-[14px] font-medium placeholder-gray-400 outline-none transition-all duration-200 focus:border-indigo-500 focus:bg-white focus:shadow-[0_0_0_3px_rgba(99,102,241,0.15)] disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isComponentLoading || !otp.trim()}
              className="mt-[8px] flex items-center justify-center gap-[10px] w-full py-[16px] px-[28px] rounded-[14px] border-none bg-gradient-to-br from-[#6366f1] to-[#4f46e5] text-white text-[15px] font-bold cursor-pointer transition-all duration-200 shadow-[0_4px_20px_rgba(99,102,241,0.35)] hover:-translate-y-[2px] hover:shadow-[0_8px_28px_rgba(99,102,241,0.5)] active:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              {isComponentLoading ? (
                <>
                  <div className="w-[18px] h-[18px] rounded-full border-[2.5px] border-[rgba(255,255,255,0.25)] border-t-white animate-spin-fast" />
                  Connecting to Meeting...
                </>
              ) : (
                'Verify & Join'
              )}
            </button>
            <button
              type="button"
              onClick={handleMobileSubmit}
              disabled={countdown > 0 || isLoading}
              className="mt-[4px] w-full py-[12px] text-[13px] font-semibold text-indigo-600 hover:text-indigo-800 disabled:text-gray-400 bg-transparent cursor-pointer transition-colors disabled:cursor-not-allowed text-center"
            >
              {countdown > 0 ? `Resend OTP in ${countdown}s` : 'Resend OTP'}
            </button>
          </form>
        )}

        {displayError && (
          <div className="mt-4 flex items-start gap-[10px] bg-[rgba(248,113,113,0.08)] border border-[rgba(248,113,113,0.2)] rounded-[12px] px-[16px] py-[12px]">
            <span className="text-[#f87171] mt-[-1px]">⚠️</span>
            <p className="text-[13px] text-[#f87171] leading-relaxed">{displayError}</p>
          </div>
        )}

        <p className="text-[11px] text-gray-400 text-center mt-[24px]">
          Powered by <strong className="text-gray-600 font-semibold">ChQMe</strong> · Secured via LiveKit
        </p>
      </div>
    </div>
  );
}
