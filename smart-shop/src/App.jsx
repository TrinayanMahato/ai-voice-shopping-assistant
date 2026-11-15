import { useState, useRef, useEffect, useMemo } from 'react';
import { Room, RoomEvent, Track, createLocalTracks } from 'livekit-client';
import { useValidateCall } from './hooks/useValidateCall';
import IntermediatePage from './components/IntermediatePage';
import { renderRemoteTrack } from './utils/trackRenderer';
import { useLocalVideoReattach } from './hooks/useLocalVideoReattach';
import { useDeviceMode } from './hooks/useDeviceMode';
import { useAutoFullscreen } from './hooks/useAutoFullscreen';
import ProductCardsComponent from './components/ProductCardsComponent';
import ImageComponent from './components/ImageComponent';
import Mp4Component from './components/Mp4Component';
import GifComponent from './components/GifComponent';
import ChatPanel from './components/ChatPanel';
import WelcomeScreen from './components/WelcomeScreen';
import AIAgentTile from './components/AIAgentTile';
import AudioOrb from './components/AudioOrb';
import AudioWaveform from './components/AudioWaveform';
import { useAudioVolume } from './hooks/useAudioVolume';

import { toRgba } from './utils/color';
import { SUGGESTION_CHIPS } from './constants';
import { useVoiceAgent } from './hooks/useVoiceAgent';
import { useMuteReminderVAD } from './hooks/useMuteReminderVAD';

const LIVEKIT_WS_URL = 'wss://smartshop.chqme.com/connect';
const STORE_CONFIG_URL = '/cart/api/chqme/store';
const END_CALL_URL = 'https://smartshop.chqme.com/xai/end_call';
const DEFAULT_SELLER_ID = 24;
const DEFAULT_SHOP = 'd2s1tg-u5.myshopify.com';
const isAIAgent = (identity) => identity.startsWith('agent-');

const DEFAULT_STORE_CONFIG = {
  themeColor: '#6366f1',
  onThemeText: '#ffffff',
  textColor: '#111827',
  bgColor: '#f6f5f3',
  logo: '',
  storeName: '',
  welcomeImage: '',
  welcomeText: '',
};

const nowLabel = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ─────────────────────────────────────────────────────────────────────────────
// App — Shopify redirects the customer to this page with ?token=&shop= params.
// useValidateCall exchanges the token for an ai_call_token, then the customer
// clicks "Start" on the IntermediatePage (ReadyToJoinScreen). Once connected,
// the full meeting UI renders.
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const hasCallToken = useMemo(() => new URLSearchParams(window.location.search).has('token'), []);
  const validateCall = useValidateCall({ enabled: hasCallToken });
  const joinInFlightRef = useRef(false);
  const callStartTimeRef = useRef(null);
  const isCallFinishedRef = useRef(true);

  const [phase, setPhase] = useState('idle');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [sentChip, setSentChip] = useState(null);
  const [isFaqDropdownOpen, setIsFaqDropdownOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');

  const roomRef = useRef(null);
  const localVideoRef = useRef(null);
  const faqDropdownRef = useRef(null);

  // Click outside to close FAQ dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (faqDropdownRef.current && !faqDropdownRef.current.contains(event.target)) {
        setIsFaqDropdownOpen(false);
      }
    }
    if (isFaqDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isFaqDropdownOpen]);

  useEffect(() => {
    if (phase === 'connected') {
      setIsFaqDropdownOpen(true);
    } else {
      setIsFaqDropdownOpen(false);
    }
  }, [phase]);

  const aiAccessTokenRef = useRef('');
  const aiIdRef = useRef(null);
  const aiConfigRef = useRef(null);
  const endCallSentRef = useRef(false);
  const handleLeaveRef = useRef(null);
  const interruptedTurnNumsRef = useRef(new Set());
  // Guard: only process the welcome message once per session, even if the
  // backend fires the 'welcome' topic more than once (two LiveKit workers reconnecting).
  const welcomeProcessedRef = useRef(false);

  const [isMicOn, setIsMicOn] = useState(false);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isAgentMuted, setIsAgentMuted] = useState(false);
  const isMicOnRef = useRef(isMicOn);
  const toggleMicRef = useRef(null);

  useEffect(() => {
    isMicOnRef.current = isMicOn;
  }, [isMicOn]);
  
  const [agentIdentity, setAgentIdentity] = useState('ai-tutor');
  const [storeConfig, setStoreConfig] = useState(DEFAULT_STORE_CONFIG);

  useEffect(() => {
    if (validateCall.sellerConfig) {
      setStoreConfig(prev => ({
        ...prev,
        themeColor: validateCall.sellerConfig.theme_color || prev.themeColor,
        onThemeText: validateCall.sellerConfig.text_color || prev.onThemeText,
        logo: validateCall.sellerConfig.logo_url || prev.logo,
        storeName: validateCall.sellerConfig.seller_name || prev.storeName,
      }));
    }
  }, [validateCall.sellerConfig]);
  const [chatMessages, setChatMessages] = useState(() => {
    try {
      const saved = sessionStorage.getItem('chatMessages');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const { isAgentThinking, setAgentStatus, handleAgentAnswer, stopAgentStream, interimTranscript, agentCaption, resetIdleTimer } = useVoiceAgent({
    roomRef,
    phase,
    isMicOn,
    setChatMessages,
    agentIdentity,
    onIdleTimeout: () => handleLeaveRef.current?.(),
  });

  const showMuteReminder = useMuteReminderVAD({ phase, isMicOn });

  const [aiAgentSpeaking, setAiAgentSpeaking] = useState(false);
  const [agentUIState, setAgentUIState] = useState({ products: [], annotation: null });
  const [sessionExpired, setSessionExpired] = useState(false);
  const [suggestionChips, setSuggestionChips] = useState(SUGGESTION_CHIPS);
  const [isMobileFaqOpen, setIsMobileFaqOpen] = useState(true);
  // True only after the agent sends the 'welcome' topic — keeps the main area blank until then
  const [agentWelcomeReceived, setAgentWelcomeReceived] = useState(false);
  const [expertWaiting, setExpertWaiting] = useState(false);
  const [agentDisplayName, setAgentDisplayName] = useState('AI');

  // Audio track states for the visualizer
  const [userMediaTrack, setUserMediaTrack] = useState(null);
  const [agentMediaTrack, setAgentMediaTrack] = useState(null);

  const userVolume = useAudioVolume(userMediaTrack, isMicOn);
  const agentVolume = useAudioVolume(agentMediaTrack, aiAgentSpeaking);
  const combinedVolume = Math.max(userVolume, agentVolume);

  useEffect(() => {
    if (sessionExpired) {
      const timer = setTimeout(() => {
        handleLeaveRef.current?.();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [sessionExpired]);

  useLocalVideoReattach(phase, isCameraOn, roomRef, localVideoRef);

  // Persist chat to sessionStorage
  useEffect(() => {
    try { sessionStorage.setItem('chatMessages', JSON.stringify(chatMessages)); } catch { }
  }, [chatMessages]);

  // ── End-call notification ──────────────────────────────────────────────────
  const sendEndCall = () => {
    console.log('[sendEndCall] Triggered! endCallSentRef:', endCallSentRef.current);
    if (endCallSentRef.current) return;
    const token = aiAccessTokenRef.current;
    const aiId = aiIdRef.current;
    console.log('[sendEndCall] token:', token, 'aiId:', aiId);
    if (!token) {
      console.log('[sendEndCall] Aborting because token is missing!');
      return;
    }
    endCallSentRef.current = true;
    
    const urlParams = new URLSearchParams(window.location.search);
    const urlToken = urlParams.get('token');
    const aiCallToken = sessionStorage.getItem('ai_call_token') || urlToken;
    console.log('[sendEndCall] aiCallToken:', aiCallToken);
    
    if (aiCallToken) {
      try {
        console.log('[sendEndCall] Firing export_transcript fetch...');
        fetch(`${API_BASE_URL}/export_transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_call_token: aiCallToken }),
          keepalive: true,
        }).catch(() => { });
      } catch { /* ignore */ }
    }

    try {
      let durationSeconds = 0;
      if (callStartTimeRef.current) {
        durationSeconds = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
      }
      console.log(`[sendEndCall] Firing END_CALL_URL fetch (duration: ${durationSeconds}s) to:`, END_CALL_URL);
      fetch(END_CALL_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'AI-CALL-TOKEN': token },
        body: JSON.stringify({ ai_id: aiId, duration_seconds: durationSeconds, finished: isCallFinishedRef.current }),
        keepalive: true,
      }).catch((e) => { console.error('[sendEndCall] fetch error:', e); });
    } catch { /* ignore */ }
  };

  useEffect(() => {
    const handler = () => sendEndCall();
    window.addEventListener('pagehide', handler);
    window.addEventListener('beforeunload', handler);
    return () => {
      window.removeEventListener('pagehide', handler);
      window.removeEventListener('beforeunload', handler);
    };
  }, []);

  const ensureFocus = () => {
    setTimeout(() => {
      if (!document.querySelector('.is-focused'))
        document.querySelector('.video-card')?.classList.add('is-focused');
    }, 50);
  };

  // ── Connect to LiveKit ─────────────────────────────────────────────────────
  const connectToLiveKit = async (token, aiAccessToken, devicePrefs = {}) => {
    try {
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;

      const publishProductId = async () => {
        try {
          const productId = sessionStorage.getItem('product_id');
          const userToken = new URLSearchParams(window.location.search).get('token');
          const payload = new TextEncoder().encode(JSON.stringify({
            product_id: productId || null,
            ai_call_token: userToken || aiAccessToken
          }));
          await room.localParticipant.publishData(payload, { reliable: true, topic: 'product-id' });
          console.log('[LiveKit] Sent product_id and ai_call_token via product-id topic:', { productId, userToken });
        } catch (e) { console.error('[LiveKit] Failed to publish product-id:', e); }
      };


      const publishVoiceName = async () => {
        try {
          if (devicePrefs.voiceId) {
            const payload = new TextEncoder().encode(JSON.stringify({
              voice_name: devicePrefs.voiceId,
              voice_gender: devicePrefs.voiceGender
            }));
            await room.localParticipant.publishData(payload, { reliable: true, topic: 'voice-name' });
            console.log('[LiveKit] Sent voice_name topic:', { voiceId: devicePrefs.voiceId, voiceGender: devicePrefs.voiceGender });
          }
        } catch (e) { console.error('[LiveKit] Failed to publish voice-name:', e); }
      };

      const publishAiId = async () => {
        try {
          const aiId = sessionStorage.getItem('ai_id');
          if (aiId) {
            const payload = new TextEncoder().encode(JSON.stringify({
              ai_id: parseInt(aiId, 10)
            }));
            await room.localParticipant.publishData(payload, { reliable: true, topic: 'ai_id' });
            console.log('[LiveKit] Sent ai_id topic:', { ai_id: aiId });
          }
        } catch (e) { console.error('[LiveKit] Failed to publish ai_id:', e); }
      };

      const publishLanguage = async () => {
        try {
          if (devicePrefs.language) {
            const payload = new TextEncoder().encode(JSON.stringify({
              language: devicePrefs.language
            }));
            await room.localParticipant.publishData(payload, { reliable: true, topic: 'language' });
            console.log('[LiveKit] Sent language topic:', { language: devicePrefs.language });
          }
        } catch (e) { console.error('[LiveKit] Failed to publish language:', e); }
      };

      room.on(RoomEvent.Connected, () => {
        console.log('[LiveKit] Connected to room:', room.name);
        setPhase('connected');
        room.remoteParticipants.forEach((p) => {
          if (isAIAgent(p.identity)) {
            setAgentIdentity(p.identity);
            publishProductId();
            publishVoiceName();
            publishLanguage();
            publishAiId();
          }
        });
      });

      room.on(RoomEvent.Disconnected, () => {
        console.log('[LiveKit] Disconnected from room');
        setPhase('idle');
        joinInFlightRef.current = false;
        setAiAgentSpeaking(false);
        setCustomerName('');
        setAgentWelcomeReceived(false);
        const el = document.getElementById('remote-tracks');
        if (el) el.innerHTML = '';
        try { sessionStorage.clear(); } catch { }
        setChatMessages([]);
        // Try to close the tab (works if opened via window.open from Shopify).
        // Falls back to "Meeting Ended" screen if browser blocks it.
        setTimeout(() => {
          try { window.close(); } catch { }
          setTimeout(() => validateCall.setPhase('ended'), 400);
        }, 500);
      });

      room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
        try {
          const str = new TextDecoder().decode(payload);
          const data = JSON.parse(str);
          if (data.event === 'expert_joined' && data.status === 15) {
            setExpertWaiting(true);
          }
        } catch (e) { }

        if (topic === 'welcome') {
          try {
            const decoder = new TextDecoder();
            const cfg = JSON.parse(decoder.decode(payload));
            setStoreConfig(prev => {
              const savedSeller = JSON.parse(sessionStorage.getItem('seller_config') || '{}');
              return {
                ...prev,
                themeColor: cfg.theme_color || cfg.primary_color || savedSeller.theme_color || prev.themeColor,
                onThemeText: cfg.text_color || cfg.font_color || savedSeller.text_color || prev.onThemeText,
                textColor: prev.textColor,
                bgColor: cfg.background_color || cfg.bg_color || prev.bgColor,
                logo: cfg.logo_url || cfg.logo || cfg.store_logo || savedSeller.logo_url || prev.logo,
                storeName: cfg.store_name || cfg.brand_name || savedSeller.seller_name || prev.storeName,
                welcomeImage: cfg.welcome_image_url || cfg.welcome_image || '',
                welcomeText: cfg.welcome_text || cfg.welcome_message || prev.welcomeText,
                annotations: cfg.annotations || [],
                mediaId: cfg.media_id,
              };
            });
            setAgentWelcomeReceived(true); // reveal the main area now
            console.log('[LiveKit] Received store config from welcome topic:', cfg);

            if (cfg.welcome_text && !welcomeProcessedRef.current) {
              // Mark as processed immediately so a second 'welcome' event (which can
              // arrive when LiveKit reconnects a second worker) does NOT call
              // handleAgentAnswer again — that would trigger stopAgentStream() and
              // kill the subtitle reveal that is already in progress.
              welcomeProcessedRef.current = true;
              setIsSidebarOpen(true);
              // Small delay so the connection fully settles before we start streaming
              // the subtitle. handleAgentAnswer owns the full lifecycle: it adds the
              // chat message AND starts the word-by-word agentCaption reveal.
              setTimeout(() => handleAgentAnswer(cfg.welcome_text), 80);
            }
          } catch (err) {
            console.error('[LiveKit] Error parsing welcome topic data', err);
          }
        }
        if (topic === 'chat') {
          const decoder = new TextDecoder();
          const str = decoder.decode(payload);
          try {
            const data = JSON.parse(str);
            setChatMessages((prev) => [...prev, { sender: 'agent', text: data.text || str, time: nowLabel() }]);
          } catch (e) {
            setChatMessages((prev) => [...prev, { sender: 'agent', text: str, time: nowLabel() }]);
          }
        }
        if (topic === 'chunk') {
          setAgentStatus('answering');
          try {
            const decoder = new TextDecoder();
            const data = JSON.parse(decoder.decode(payload));
            if (data.chunk) {
              if (data.turn_id) {
                const turnNum = parseInt(data.turn_id.split('_').pop(), 10);
                if (interruptedTurnNumsRef.current.has(turnNum)) {
                  console.log(`[LiveKit] 🗑️ Ignoring chunk from interrupted turn ${turnNum}`);
                  return;
                }
              }
              setChatMessages((prev) => {
                const newArr = [...prev];
                const lastMsg = newArr[newArr.length - 1];

                // If the last message is an active streaming message from the agent, append to it
                if (lastMsg && lastMsg.sender === 'agent' && lastMsg.isStreaming) {
                  lastMsg.text += data.chunk;
                } else {
                  // Otherwise, create a new streaming message
                  newArr.push({ sender: 'agent', text: data.chunk, time: nowLabel(), isStreaming: true });
                }
                return newArr;
              });
            }
          } catch (e) { console.error('Error parsing chunk:', e); }
        }
        if (topic === 'status') {
          try {
            const decoder = new TextDecoder();
            const data = JSON.parse(decoder.decode(payload));
            if (data.question) {
              console.log('[LiveKit] 🗣️ Received transcribed question from agent status:', data.question);
              setChatMessages((prev) => {
                const userMessages = prev.filter(m => m.sender === 'user');
                const lastUserMsg = userMessages[userMessages.length - 1];
                if (lastUserMsg && lastUserMsg.text === data.question) return prev;
                return [...prev, { sender: 'user', text: data.question, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }];
              });
            }
            if (data.status) {
              setAgentStatus(data.status, data.filler || '');
            }
          } catch { }
        }
        if (topic === 'interrupted') {
          try {
            const decoder = new TextDecoder();
            const data = JSON.parse(decoder.decode(payload));
            if (data.turn_number !== undefined) {
              interruptedTurnNumsRef.current.add(data.turn_number);
              console.log(`[LiveKit] 🛑 Received interrupt signal for turn ${data.turn_number}, blocking future chunks.`);
            }
          } catch (e) {
            console.log('[LiveKit] 🛑 Received interrupt signal, clearing text buffer and stopping animation');
          }
          stopAgentStream();
          setAgentStatus('listening');
          setChatMessages((prev) => {
            const newArr = [...prev];
            // A user message might have just been added to the end of the array (e.g. text input),
            // so we search backwards to find the agent's ongoing streaming message and remove it.
            for (let i = newArr.length - 1; i >= 0; i--) {
              if (newArr[i].sender === 'agent') {
                if (newArr[i].isStreaming) {
                  newArr[i] = { ...newArr[i], isStreaming: false };
                }
                break;
              }
            }
            return newArr;
          });
        }
        if (topic === 'agent-ui') {
          try {
            const decoder = new TextDecoder();
            const str = decoder.decode(payload);
            const data = JSON.parse(str);
            if (data.question) {
              console.log('[LiveKit] 🗣️ Received transcribed question from agent-ui:', data.question);
              setChatMessages((prev) => {
                // To avoid duplicating text messages (which are added instantly on submit),
                // we check if the most recent user message matches this question exactly.
                const userMessages = prev.filter(m => m.sender === 'user');
                const lastUserMsg = userMessages[userMessages.length - 1];
                if (lastUserMsg && lastUserMsg.text === data.question) {
                  return prev;
                }
                // Add the spoken question to the transcript
                return [...prev, { sender: 'user', text: data.question, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }];
              });
            }
            if (data.answer) handleAgentAnswer(data.answer);
            if (data.status === 'interrupted') {
              stopAgentStream();
              setAgentStatus('error', '');
            } else if (data.status === 'thinking') {
              setAgentStatus('thinking', data.filler || '');
            }
            if (data.status_code === -1) {
              setSessionExpired(true);
            }
            if (data.products !== undefined) {
              setAgentUIState((prev) => {
                const newProducts = data.products.map(p => ({
                  ...p,
                  featured_image: p.feature_image || p.featured_image,
                  images: p.images || (p.media_gallery || []).map(m => m.media_url)
                }));

                if (newProducts.length > 1) {
                  // Display products in the form of cards, clear any single-image annotation
                  return { products: newProducts, annotation: null };
                }

                if (newProducts.length === 1) {
                  let newAnnotation = null;

                  if (data.feature_media && data.feature_media.length > 0) {
                    const feature = data.feature_media[0];
                    newAnnotation = {
                      image_url: feature.media_params?.image?.url || newProducts[0].featured_image,
                      image_width: feature.media_params?.image?.width || 800,
                      image_height: feature.media_params?.image?.height || 800,
                      focus_label: feature.feature_name,
                      regions: feature.media_params?.bbox ? [{
                        label: feature.feature_name,
                        bbox: feature.media_params.bbox,
                        center: feature.media_params.center || { x: feature.media_params.bbox.x + feature.media_params.bbox.width / 2, y: feature.media_params.bbox.y + feature.media_params.bbox.height / 2 }
                      }] : []
                    };
                  } else if (data.highlighted_feature) {
                    const highlight = data.highlighted_feature;
                    const regions = (highlight.features || [])
                      .filter(f => f.media_params?.bbox)
                      .map(f => ({
                        label: f.feature_name,
                        bbox: f.media_params.bbox,
                        center: f.media_params.center || { x: f.media_params.bbox.x + f.media_params.bbox.width / 2, y: f.media_params.bbox.y + f.media_params.bbox.height / 2 }
                      }));

                    let imgWidth = 800, imgHeight = 800;
                    let featImageUrl = null;
                    const firstFeatWithImg = (highlight.features || []).find(f => f.media_params?.image?.width);
                    if (firstFeatWithImg) {
                      imgWidth = firstFeatWithImg.media_params.image.width;
                      imgHeight = firstFeatWithImg.media_params.image.height;
                      featImageUrl = firstFeatWithImg.media_params.image.url;
                    }

                    newAnnotation = {
                      image_url: featImageUrl || highlight.media_url || newProducts[0].featured_image,
                      image_width: imgWidth,
                      image_height: imgHeight,
                      focus_label: null,
                      regions: regions
                    };
                  } else {
                    newAnnotation = {
                      image_url: newProducts[0].featured_image,
                      focus_label: null,
                      regions: []
                    };
                  }

                  return { products: newProducts, annotation: newAnnotation };
                }

                return { products: [], annotation: null };
              });
            }
            if (data.question_for_you && data.question_for_you.length > 0) {
              setSuggestionChips(data.question_for_you);
            }
          } catch (err) {
            console.error('Error parsing agent-ui data', err);
          }
        }
        if (topic === 'end_call') {
          console.log('[LiveKit] 🛑 Received end_call event from agent due to inactivity.');
          handleLeaveRef.current?.();
        }
      });

      room.on(RoomEvent.ParticipantConnected, (p) => {
        if (isAIAgent(p.identity)) {
          setAgentIdentity(p.identity);
          publishProductId();
          publishVoiceName();
          publishLanguage();
          publishAiId();
        }
      });

      room.on(RoomEvent.ParticipantDisconnected, (p) => {
        if (isAIAgent(p.identity)) {
          setAiAgentSpeaking(false);
        }
        p.trackPublications.forEach((pub) => {
          document.getElementById(`track-${pub.trackSid}-container`)?.remove();
          document.getElementById(`track-${pub.trackSid}-audio`)?.remove();
        });
        ensureFocus();
      });

      room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
        if (isAIAgent(participant.identity)) {
          if (track.kind === Track.Kind.Audio) {
            setAgentMediaTrack(track.mediaStreamTrack);
            if (document.getElementById(`track-${pub.trackSid}-audio`)) return;
            const audioEl = track.attach();
            audioEl.id = `track-${pub.trackSid}-audio`;
            audioEl.style.display = 'none';
            document.body.appendChild(audioEl);
          }
          return;
        }
        renderRemoteTrack(pub, participant);
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
        track.detach();
        document.getElementById(`track-${pub.trackSid}-container`)?.remove();
        document.getElementById(`track-${pub.trackSid}-audio`)?.remove();
        ensureFocus();
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const isAISpeaking = speakers.some((s) => isAIAgent(s.identity));
        setAiAgentSpeaking(isAISpeaking);

        const amISpeaking = speakers.some((s) => s.identity === room.localParticipant.identity);
        if (amISpeaking) {
          console.log('[LiveKit] 🎙️ You are currently speaking! Audio is actively streaming to the server.');
        }
      });

      await room.connect(LIVEKIT_WS_URL, token);

      const agentCount = Array.from(room.remoteParticipants.values()).filter(p => isAIAgent(p.identity)).length;
      if (agentCount > 1) console.warn(`[LiveKit] ⚠️ ${agentCount} AI agents detected in room — echo likely!`);
      console.log('[LiveKit] Participants already in room:', Array.from(room.remoteParticipants.values()).map(p => p.identity));



      const wantAudio = devicePrefs.wantMic ?? devicePrefs.isMicOn ?? false;
      const wantVideo = devicePrefs.wantCamera ?? devicePrefs.isCameraOn ?? true;
      setIsMicOn(wantAudio);
      setIsCameraOn(wantVideo);
      setIsAgentMuted(devicePrefs.isAgentMuted || false);

      console.log(`[LiveKit] Init Tracks - wantAudio: ${wantAudio}, wantVideo: ${wantVideo}`);

      const localTracks = await createLocalTracks({
        audio: wantAudio ? {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(devicePrefs.audioDeviceId ? { deviceId: devicePrefs.audioDeviceId } : {}),
        } : false,
        video: wantVideo ? (devicePrefs.videoDeviceId ? { deviceId: devicePrefs.videoDeviceId } : true) : false,
      });

      console.log(`[LiveKit] Created ${localTracks.length} local tracks.`);

      for (const track of localTracks) {
        await room.localParticipant.publishTrack(track);
        console.log(`[LiveKit] Successfully published track: ${track.kind}`);
        if (track.kind === Track.Kind.Audio) {
          setUserMediaTrack(track.mediaStreamTrack);
        }
        if (track.kind === Track.Kind.Video && localVideoRef.current)
          track.attach(localVideoRef.current);
      }

      room.remoteParticipants.forEach((p) => {
        if (isAIAgent(p.identity)) return;
        p.trackPublications.forEach((pub) => { if (pub.isSubscribed) renderRemoteTrack(pub, p); });
      });
    } catch (err) {
      console.error('[LiveKit Connect]', err);
      throw err;
    }
  };

  // ── Token-redirect join ────────────────────────────────────────────────────
  // Called when the customer clicks "Start Smart Demo" on the IntermediatePage.
  // generate_meeting_token on the backend already dispatches the AI agent —
  // we just need to exchange the ai_call_token for the LiveKit room token.
  const handleJoinRoomFromToken = async (devicePrefs = {}) => {
    if (joinInFlightRef.current) return;
    joinInFlightRef.current = true;
    validateCall.setPhase('joining');

    const dName = devicePrefs.voiceId === 'shubh' ? 'Trinayan' : devicePrefs.voiceId === 'sumit' ? 'Aman' : devicePrefs.voiceId === 'ritu' ? 'Heli' : devicePrefs.voiceId === 'priya' ? 'Tanya' : 'AI';
    setAgentDisplayName(dName);

    try {
      const userToken = new URLSearchParams(window.location.search).get('token');
      const aiCallToken = sessionStorage.getItem('ai_call_token') || userToken;

      const res = await fetch('https://smartshop.chqme.com/xai/generate_meeting_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: aiCallToken }),
      });
      const data = await res.json();
      if (data.status_code !== 0) {
        if (data.status_msg === "Meeting is already in progress") {
          alert("you cant join the meeting");
          joinInFlightRef.current = false;
          return;
        }
        throw new Error(data.status_msg || 'Failed to generate LiveKit token');
      }
      const returnData = (data.return_data || [])[0] || {};
      const livekitToken = returnData.token;
      if (!livekitToken) throw new Error('No token returned from server');

      const aiAccessToken = sessionStorage.getItem('ai_access_token') || aiCallToken;
      aiAccessTokenRef.current = aiAccessToken;
      const aiId = sessionStorage.getItem('ai_id');
      if (aiId) aiIdRef.current = aiId;
      endCallSentRef.current = false;
      callStartTimeRef.current = Date.now(); // Record start time of the meeting

      if (validateCall.userName) setCustomerName(validateCall.userName);
      await connectToLiveKit(livekitToken, aiAccessToken, devicePrefs);
    } catch (err) {
      console.error(err);
      validateCall.setErrMsg(`Failed to join: ${err.message}`);
      validateCall.setPhase('error');
      joinInFlightRef.current = false;
    }
  };

  const toggleAgentMute = async () => {
    if (!roomRef.current) return;
    const nextState = !isAgentMuted;
    try {
      const payload = new TextEncoder().encode(JSON.stringify({
        tts_status: !nextState // false = muted, true = speaking
      }));
      await roomRef.current.localParticipant.publishData(payload, { reliable: true, topic: 'mute-agent' });
      setIsAgentMuted(nextState);
      console.log(`[LiveKit] Agent mute state toggled to: ${nextState}`);
    } catch (e) {
      console.error('[LiveKit] Failed to toggle agent mute:', e);
    }
  };

  const toggleMic = async (forceState) => {
    if (!roomRef.current) return;
    try {
      if (typeof forceState !== 'boolean') return; // Strict PTT mode, no toggling allowed
      const targetState = forceState;
      if (targetState === isMicOn) return;

      const pubs = Array.from(roomRef.current.localParticipant.audioTrackPublications.values())
        .filter(pub => pub.track && pub.source === Track.Source.Microphone);

      if (!targetState) {
        // ── Mute: silence the track at the OS level AND signal muted to the server.
        // Using setMuted(true) on the publication tells the LiveKit SFU to stop
        // forwarding audio frames — the server-side Whisper STT will receive silence.
        // We also disable the underlying MediaStreamTrack so the browser mic indicator
        // goes off and no audio bytes flow over the wire at all.
        for (const pub of pubs) {
          if (pub.track?.mediaStreamTrack) {
            pub.track.mediaStreamTrack.enabled = false;
          }
          await pub.mute();
        }
        setUserMediaTrack(null);
      } else {
        // ── Unmute: re-enable the OS track and signal active to the server.
        if (pubs.length > 0) {
          for (const pub of pubs) {
            if (pub.track?.mediaStreamTrack) {
              pub.track.mediaStreamTrack.enabled = true;
            }
            await pub.unmute();
            if (pub.track?.mediaStreamTrack) {
              setUserMediaTrack(pub.track.mediaStreamTrack);
            }
          }
        } else {
          // No track published at all (was started with mic off) — create one now.
          const tracks = await createLocalTracks({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
            video: false,
          });
          for (const t of tracks) {
            if (t.source === Track.Source.Microphone) {
              await roomRef.current.localParticipant.publishTrack(t);
              if (t.kind === Track.Kind.Audio) {
                setUserMediaTrack(t.mediaStreamTrack);
              }
            }
          }
        }
      }
      setIsMicOn(targetState);
    } catch (err) { console.error('[toggleMic]', err); }
  };

  useEffect(() => {
    toggleMicRef.current = toggleMic;
  }, [toggleMic]);

  // Desktop PTT logic
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (!isMicOnRef.current && toggleMicRef.current) {
          toggleMicRef.current(true);
        }
      }
    };
    const handleKeyUp = (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (isMicOnRef.current && toggleMicRef.current) {
          toggleMicRef.current(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);


  const toggleCamera = async () => {
    if (!roomRef.current) return;
    if (isCameraOn) {
      for (const pub of roomRef.current.localParticipant.videoTrackPublications.values())
        if (pub.track && pub.source === Track.Source.Camera) {
          pub.track.detach();
          await roomRef.current.localParticipant.unpublishTrack(pub.track);
        }
      if (localVideoRef.current) localVideoRef.current.srcObject = null;
    } else {
      const tracks = await createLocalTracks({ audio: false, video: true });
      for (const t of tracks)
        if (t.source === Track.Source.Camera) {
          await roomRef.current.localParticipant.publishTrack(t);
          if (localVideoRef.current) t.attach(localVideoRef.current);
        }
    }
    setIsCameraOn((v) => !v);
  };



  const handleLeave = async (skipEndCall = false) => {
    if (!skipEndCall) {
      sendEndCall();
    }
    try { await roomRef.current?.disconnect(); } catch (e) { console.error(e); }
    roomRef.current = null;
    aiAccessTokenRef.current = '';
    aiIdRef.current = null;
    aiConfigRef.current = null;
    joinInFlightRef.current = false;
    setAiAgentSpeaking(false);
    setAgentUIState({ products: [], annotation: null });
    setChatMessages([]);
    setCustomerName('');
    sessionStorage.removeItem('cachedProducts');
    sessionStorage.removeItem('cachedAnnotation');
    sessionStorage.removeItem('chatMessages');
    validateCall.setPhase('ended');
    setPhase('idle');
    // Try to close tab automatically. If blocked, they'll see the "Meeting Ended" screen.
    setTimeout(() => {
      try { window.close(); } catch { }
    }, 100);
  };
  handleLeaveRef.current = handleLeave;

  const handleSendMessage = async (text) => {
    if (!roomRef.current) return;
    // Interrupt any ongoing agent speech/thinking immediately (same as audio VAD interrupt)
    stopAgentStream();
    setAgentStatus('listening');
    // Mark any currently-streaming agent message as done
    setChatMessages((prev) => {
      const newArr = [...prev];
      for (let i = newArr.length - 1; i >= 0; i--) {
        if (newArr[i].sender === 'agent' && newArr[i].isStreaming) {
          newArr[i] = { ...newArr[i], isStreaming: false };
          break;
        }
      }
      return newArr;
    });
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify({ text }));
      await roomRef.current.localParticipant.publishData(data, { reliable: true, topic: 'user-input' });
      resetIdleTimer();
      setChatMessages((prev) => [...prev, { sender: 'user', text, time: nowLabel() }]);
    } catch (err) { console.error('[Chat]', err); }
  };

  const handleFeatureClick = async (label) => {
    if (!roomRef.current) return;
    // Interrupt any ongoing agent speech/thinking immediately
    stopAgentStream();
    setAgentStatus('listening');
    setChatMessages((prev) => {
      const newArr = [...prev];
      for (let i = newArr.length - 1; i >= 0; i--) {
        if (newArr[i].sender === 'agent' && newArr[i].isStreaming) {
          newArr[i] = { ...newArr[i], isStreaming: false };
          break;
        }
      }
      return newArr;
    });
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify({ text: label }));
      await roomRef.current.localParticipant.publishData(data, { reliable: true, topic: 'user-input' });
      resetIdleTimer();
      setChatMessages((prev) => [...prev, { sender: 'user', text: label, time: nowLabel() }]);
    } catch (err) { console.error('[Feature Click]', err); }
  };

  const handleClearTranscript = () => {
    setChatMessages([]);
    try { sessionStorage.removeItem('chatMessages'); } catch { }
  };

  const handleChipClick = (chip) => {
    handleSendMessage(chip);
    setSentChip(chip);
    setTimeout(() => setSentChip((c) => (c === chip ? null : c)), 1200);
  };

  const handleExpertContinue = () => {
    isCallFinishedRef.current = false; // Mark the call as transferred, not finished

    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const aiCallToken = sessionStorage.getItem('ai_call_token') || token;

    if (aiCallToken) {
      try {
        fetch(`${API_BASE_URL}/export_transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_call_token: aiCallToken }),
          keepalive: true,
        }).catch(() => { });
      } catch (e) { }
    }

    if (handleLeaveRef.current) {
      handleLeaveRef.current(true);
    }

    if (token) {
      window.location.href = `http://experience.chqme.com/?token=${token}&type=id`;
    } else {
      window.location.href = `http://experience.chqme.com/`;
    }
  };

  // Derived branding values
  const theme = storeConfig.themeColor;
  const themeText = storeConfig.textColor;
  const onTheme = storeConfig.onThemeText;
  const themeBg = storeConfig.bgColor;
  const brandLogo = storeConfig.logo;
  const displayName = storeConfig.storeName || 'Assistant';
  const welcomeImage = storeConfig.welcomeImage;

  const { isMobile } = useDeviceMode();
  useAutoFullscreen(isMobile);

  // ── IntermediatePage (pre-join) ────────────────────────────────────────────
  if (phase !== 'connected') {
    return (
      <IntermediatePage
        phase={validateCall.phase}
        errMsg={validateCall.errMsg}
        userName={validateCall.userName}
        meetingDetails={validateCall.meetingDetails}
        sellerConfig={validateCall.sellerConfig}
        handleJoinRoom={handleJoinRoomFromToken}
      />
    );
  }

  // ── Main Meeting UI ────────────────────────────────────────────────────────
  return (
    <>
      {sessionExpired && (
        <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-gray-900/60 backdrop-blur-md pointer-events-auto transition-all duration-500">
          <div className="bg-white rounded-[24px] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.3)] p-10 max-w-[360px] w-full mx-6 text-center flex flex-col items-center border border-gray-100">
            <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-5 border-[4px] border-white shadow-[0_4px_12px_rgba(239,68,68,0.15)]">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </div>
            <h2 className="text-[20px] font-extrabold text-gray-900 mb-2 tracking-tight">Session Expired</h2>
            <p className="text-[14px] text-gray-500 font-medium leading-relaxed mb-6">
              Your session has ended. To continue exploring, please start a new AI Demo.
            </p>
            <div className="w-full flex justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-gray-200 border-t-red-500 animate-spin"></div>
            </div>
          </div>
        </div>
      )}
      <div className="flex flex-col min-[1200px]:flex-row overflow-hidden min-h-0 w-full h-[100dvh] bg-[#f8f9fa] text-gray-800 font-sans">

        {/* ── Main Dashboard Area (Center) ── */}
        <div className="flex-1 min-w-0 flex flex-col relative z-10 min-[1200px]:h-full shrink-0">

          {/* Actual Content (Products / Hotspots) */}
          <div className="flex-1 min-h-0 relative w-full h-full flex flex-col p-0 min-[1200px]:pl-10 min-[1200px]:pb-10 min-[1200px]:pt-0 min-[1200px]:pr-4">
            <div className="w-full h-full bg-white min-[1200px]:rounded-b-2xl min-[1200px]:rounded-tr-2xl shadow-sm border-0 min-[1200px]:border border-gray-200/60 overflow-hidden relative flex flex-col items-center justify-center">

              {expertWaiting && (
                <div className="absolute inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
                  <div className="relative bg-white rounded-[28px] w-full max-w-[360px] overflow-hidden" style={{ boxShadow: '0 32px 80px -12px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.12)', animation: 'expertPopIn 0.35s cubic-bezier(0.34,1.56,0.64,1) both' }}>

                    {/* Top accent band */}
                    <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${theme}, ${toRgba(theme, 0.5)})` }} />

                    <div className="p-7 flex flex-col items-center text-center">

                      {/* Live badge */}
                      <div className="flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1 mb-5 self-center">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-widest">Live</span>
                      </div>

                      {/* Avatar with ripple rings */}
                      <div className="relative mb-5 flex items-center justify-center">
                        <span className="absolute w-20 h-20 rounded-full animate-ping opacity-10" style={{ background: theme }}></span>
                        <span className="absolute w-16 h-16 rounded-full opacity-15" style={{ background: theme, animation: 'pulse 2s cubic-bezier(0.4,0,0.6,1) infinite 0.5s' }}></span>
                        <div className="relative w-14 h-14 rounded-full flex items-center justify-center border-[3px] border-white" style={{ background: `linear-gradient(135deg, ${toRgba(theme, 0.12)}, ${toRgba(theme, 0.22)})`, boxShadow: `0 4px 20px ${toRgba(theme, 0.25)}` }}>
                          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={theme} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                        </div>
                        {/* Online indicator dot */}
                        <span className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full"></span>
                      </div>

                      <h3 className="text-[19px] font-extrabold text-gray-900 tracking-tight mb-1">Expert is Ready</h3>
                      <p className="text-[13.5px] text-gray-500 leading-relaxed mb-6 max-w-[260px]">
                        A human specialist is standing by to assist you in real-time.
                      </p>

                      {/* CTA Button */}
                      <button
                        onClick={handleExpertContinue}
                        className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-[14px] font-bold text-white transition-all duration-200 hover:brightness-110 hover:-translate-y-0.5 active:scale-[0.98]"
                        style={{ background: `linear-gradient(135deg, ${theme}, ${toRgba(theme, 0.8)})`, boxShadow: `0 6px 20px ${toRgba(theme, 0.45)}` }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                        </svg>
                        Connect with Expert
                      </button>

                      <button
                        onClick={() => setExpertWaiting(false)}
                        className="mt-3 text-[12px] text-gray-400 hover:text-gray-600 font-medium transition-colors"
                      >
                        Dismiss
                      </button>

                    </div>
                  </div>

                  <style>{`
                    @keyframes expertPopIn {
                      from { opacity: 0; transform: scale(0.88) translateY(12px); }
                      to   { opacity: 1; transform: scale(1) translateY(0); }
                    }
                  `}</style>
                </div>
              )}

              {agentWelcomeReceived && (!agentUIState.products || agentUIState.products.length === 0) && (
                <WelcomeScreen
                  theme={theme}
                  onTheme={onTheme}
                  displayName={displayName}
                  welcomeImage={welcomeImage}
                  annotations={storeConfig?.annotations || []}
                />
              )}
              {agentUIState.products && agentUIState.products.length > 1 && (
                <ProductCardsComponent products={agentUIState.products} annotation={agentUIState.annotation} mobile={isMobile} onProductTap={(p) => handleFeatureClick(`Tell me more about ${p.title || p.product_title || p.name || 'this product'}`)} />
              )}
              {agentUIState.products && agentUIState.products.length === 1 && agentUIState.annotation && (
                (() => {
                  const product = agentUIState.products[0];
                  const ext = agentUIState.annotation.image_url
                    ? agentUIState.annotation.image_url.split('.').pop().toLowerCase().split('?')[0]
                    : (product.featured_image ? product.featured_image.split('.').pop().toLowerCase() : '');
                  if (ext === 'mp4') return <Mp4Component product={product} annotation={agentUIState.annotation} onFeatureClick={handleFeatureClick} />;
                  if (ext === 'gif') return <GifComponent product={product} annotation={agentUIState.annotation} onFeatureClick={handleFeatureClick} />;
                  return <ImageComponent product={product} annotation={agentUIState.annotation} onFeatureClick={handleFeatureClick} theme={theme} onTheme={onTheme} />;
                })()
              )}

            </div>
          </div>

          {/* ── DESKTOP Overlays (Hidden on Mobile) ── */}
          <div className="hidden min-[1200px]:block">
            {/* Desktop Floating FAQ Removed */}

            {/* Desktop Subtitles & Status Overlay */}
            {((phase === 'connected' && (isAgentThinking || aiAgentSpeaking || isMicOn)) || agentCaption || interimTranscript) && (
              <div className="absolute bottom-24 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3 z-40 pointer-events-none w-[90%] max-w-[700px] transition-all duration-300">

                {/* Status Badge */}
                {phase === 'connected' && (isAgentThinking || aiAgentSpeaking || isMicOn) && (
                  <div className="bg-gray-900/95 backdrop-blur-md border border-gray-800 shadow-[0_8px_30px_rgba(0,0,0,0.3)] rounded-full px-5 py-2 flex items-center gap-3 transition-all duration-300" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
                    {isAgentThinking ? (
                      <>
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span>
                        </span>
                        <span className="text-[11px] font-extrabold text-white tracking-widest uppercase">{agentDisplayName} is thinking...</span>
                      </>
                    ) : aiAgentSpeaking ? (
                      <>
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                        </span>
                        <span className="text-[11px] font-extrabold text-white tracking-widest uppercase">{agentDisplayName} is speaking...</span>
                      </>
                    ) : (
                      <>
                        <span className="relative flex h-2.5 w-2.5">
                          <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                        </span>
                        <span className="text-[11px] font-bold text-white tracking-widest uppercase">{agentDisplayName} is listening...</span>
                      </>
                    )}
                  </div>
                )}

                {/* Subtitles */}
                {interimTranscript && (
                  <div className="bg-black/30 text-gray-50 px-6 py-3 rounded-2xl text-[16px] leading-relaxed w-full min-h-[44px] flex flex-col justify-center text-center backdrop-blur-md shadow-xl border border-white/10" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
                    <span className="drop-shadow-md line-clamp-1 font-medium tracking-wide">{interimTranscript}</span>
                  </div>
                )}
                {agentCaption && (
                  <div className="bg-black/30 text-white px-6 py-3 rounded-2xl text-[16px] leading-relaxed w-full min-h-[44px] flex flex-col justify-center text-center backdrop-blur-md shadow-xl border border-white/10" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
                    <span className="drop-shadow-md line-clamp-1 font-medium tracking-wide">{agentCaption}</span>
                  </div>
                )}
              </div>
            )}

            {/* Desktop Audio Waveform */}
            <div className="absolute bottom-[84px] left-0 w-full h-12 z-30 pointer-events-none opacity-70 px-8 flex items-end justify-center">
              <div className="w-full max-w-[1200px] h-full flex items-center justify-center">
                <AudioWaveform
                  volume={combinedVolume}
                  isAgentSpeaking={aiAgentSpeaking}
                  isUserSpeaking={userVolume > 0.02}
                  theme={theme}
                />
              </div>
            </div>

            {/* Desktop Bottom Floating Dock */}
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4 z-50 pointer-events-auto bg-white/90 backdrop-blur-2xl p-2.5 rounded-full shadow-[0_16px_40px_rgba(0,0,0,0.12)] border border-gray-200/60 w-[90%] max-w-[560px]">
              {/* Mic Button */}
              <div className="relative flex items-center justify-center">
                {showMuteReminder && (
                  <div className="absolute -top-[42px] left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap z-50 pointer-events-none animate-bounce">
                    Press and hold to ask
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-gray-800"></div>
                  </div>
                )}
                <button onPointerDown={(e) => { e.preventDefault(); toggleMic(true); }} onPointerUp={(e) => { e.preventDefault(); toggleMic(false); }} onPointerLeave={() => toggleMic(false)} onContextMenu={(e) => e.preventDefault()} className="flex-shrink-0 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-105 touch-none" style={isMicOn ? { background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb' } : { background: '#fee2e2', color: '#ef4444', border: '1px solid #fecaca' }} title={isMicOn ? 'Release to Mute' : 'Hold to Speak'}>
                  {isMicOn ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                  )}
                </button>
              </div>

              {/* Input Field Form */}
              <form onSubmit={(e) => { e.preventDefault(); const val = e.target.elements.chatInputDesktop.value.trim(); if (val) { handleSendMessage(val); e.target.elements.chatInputDesktop.value = ''; } }} className="flex-1 flex items-center h-11 px-4 bg-gray-50 border border-gray-200/70 rounded-full focus-within:bg-white focus-within:border-gray-300 transition-colors shadow-inner">
                <input name="chatInputDesktop" type="text" autoComplete="off" placeholder="Ask anything..." className="w-full bg-transparent outline-none text-[13.5px] text-gray-800 placeholder-gray-400" />
                <button type="submit" className="flex-shrink-0 ml-2 w-7 h-7 rounded-full bg-white flex items-center justify-center border border-gray-200 text-gray-500 hover:text-indigo-600 hover:border-indigo-200 transition-colors shadow-sm">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                </button>
              </form>

              {/* Mute Agent Button (Desktop) */}
              <button onClick={toggleAgentMute} className={`flex-shrink-0 text-[13px] font-bold px-4 h-11 rounded-full flex items-center justify-center gap-2 transition-all shadow-sm active:scale-95 border ${isAgentMuted ? 'bg-orange-50 text-orange-600 border-orange-200 hover:bg-orange-100' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`} title={isAgentMuted ? "Unmute Agent" : "Mute Agent"}>
                {isAgentMuted ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                )}
                <span className="hidden sm:inline">{isAgentMuted ? "Agent Muted" : "Mute Agent"}</span>
              </button>

              {/* End Call Button */}
              <button onClick={() => handleLeave()} className="flex-shrink-0 bg-red-50 hover:bg-red-100 text-red-500 text-[13px] font-bold px-4 h-11 rounded-full flex items-center justify-center gap-2 transition-all border border-red-100 shadow-sm active:scale-95" title="End Call">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" /><line x1="23" y1="1" x2="1" y2="23" /></svg>
                <span className="hidden sm:inline">End</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Desktop Sidebar & Mobile Lower Area ── */}
        <div className="flex flex-col min-[1200px]:w-[260px] min-[1200px]:h-full shrink-0 bg-white min-[1200px]:bg-[#f8f9fa] border-t min-[1200px]:border-t-0 min-[1200px]:border-l border-gray-200 z-20">

          <div className="flex-1 flex flex-col w-full min-[1200px]:h-full min-h-0 items-center justify-end min-[1200px]:justify-start min-[1200px]:items-stretch px-3 min-[1200px]:p-4 min-[1200px]:gap-4">

            {/* Mobile Subtitles Area (Top of 30%) */}
            <div className="min-[1200px]:hidden flex flex-col items-center gap-2 w-full min-h-0 mb-1.5 overflow-hidden pt-3">
              {/* Mobile Status Badge */}
              {phase === 'connected' && (isAgentThinking || aiAgentSpeaking || isMicOn) && (
                <div className="bg-gray-900/95 backdrop-blur-md border border-gray-800 shadow-md rounded-full px-4 py-1.5 flex items-center gap-2" style={{ animation: 'fadeInUp 0.3s ease-out' }}>
                  {isAgentThinking ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                      </span>
                      <span className="text-[10px] font-extrabold text-white tracking-widest uppercase">{agentDisplayName} is thinking...</span>
                    </>
                  ) : aiAgentSpeaking ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                      </span>
                      <span className="text-[10px] font-extrabold text-white tracking-widest uppercase">{agentDisplayName} is speaking...</span>
                    </>
                  ) : (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                      </span>
                      <span className="text-[10px] font-bold text-white tracking-widest uppercase">Listening</span>
                    </>
                  )}
                </div>
              )}

              {(interimTranscript || agentCaption) && (
                <div className="bg-black/30 backdrop-blur-md shadow-lg border border-white/10 text-white px-3 py-1.5 rounded-lg text-[12px] leading-tight w-full text-center shrink-0">
                  <span className="drop-shadow-md line-clamp-1">{interimTranscript || agentCaption}</span>
                </div>
              )}
            </div>

            {/* Mobile Suggested Questions */}
            <div className="min-[1200px]:hidden flex w-full overflow-x-auto custom-scrollbar gap-2 mb-2 shrink-0 py-1">
              {(agentUIState?.question_for_you?.length > 0 ? agentUIState.question_for_you : suggestionChips).map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSendMessage(q)}
                  className="shrink-0 text-left px-3 py-1.5 bg-gray-50 border border-gray-200/80 hover:bg-gray-100 rounded-full text-[12px] text-gray-700 font-medium transition-all"
                >
                  {q}
                </button>
              ))}
            </div>

            {/* Empty div containing Chat Input (Mobile Only) */}
            <div className="min-[1200px]:hidden w-full shrink-0 mb-2">
              <form onSubmit={(e) => { e.preventDefault(); const val = e.target.elements.chatInputMobile.value.trim(); if (val) { handleSendMessage(val); e.target.elements.chatInputMobile.value = ''; } }} className="flex-1 flex items-center h-11 px-3 bg-gray-100 border border-gray-200 rounded-full focus-within:bg-white focus-within:border-gray-300 transition-colors shadow-inner">
                <input name="chatInputMobile" type="text" autoComplete="off" placeholder="Ask anything..." className="w-full bg-transparent outline-none text-[13px] text-gray-800 placeholder-gray-400" />
                <button type="submit" className="flex-shrink-0 ml-1 w-7 h-7 rounded-full bg-white flex items-center justify-center border border-gray-200 text-gray-500">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                </button>
              </form>
            </div>

            {/* Media Row & Desktop Video Tiles */}
            {/* Mobile: Space Between (Camera left, Buttons center, Agent right) */}
            {/* Desktop: Column (Camera top, Agent middle, Remote bottom) */}
            <div className="flex flex-row justify-between min-[1200px]:flex-col w-full items-center min-[1200px]:items-stretch gap-2 min-[1200px]:gap-4 shrink-0 pb-3 min-[1200px]:pb-0">

              {/* User Local Video (Bottom Left on Mobile) */}
              <div className="flex items-center gap-2">
                <div className="relative w-12 h-12 min-[1200px]:w-full min-[1200px]:h-auto min-[1200px]:aspect-[4/3] bg-gradient-to-br from-gray-200 to-gray-300 rounded-full min-[1200px]:rounded-[14px] overflow-hidden shadow-sm flex items-center justify-center border border-gray-200 shrink-0">
                  <video ref={localVideoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 bg-black" />
                  {/* Desktop overlay info */}
                  <div className="hidden min-[1200px]:block absolute top-3 right-3 bg-gray-900/60 p-1.5 rounded-full text-white backdrop-blur-md border border-white/10">
                    {!isMicOn ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2.5"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
                    )}
                  </div>
                  <div className="hidden min-[1200px]:block absolute bottom-3 right-3 bg-gray-900/60 backdrop-blur-md px-2.5 py-1 rounded-md text-[11px] font-bold text-white tracking-wide border border-white/10 shadow-sm">
                    You
                  </div>
                  {/* Mobile mute overlay */}
                  <div className="min-[1200px]:hidden absolute bottom-0 right-0 bg-gray-900/80 p-0.5 rounded-full text-white border border-gray-800">
                    {!isMicOn && <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="3"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>}
                  </div>

                  {/* Desktop Camera Toggle Button */}
                  <button onClick={toggleCamera} className="hidden min-[1200px]:flex absolute bottom-3 left-3 bg-gray-900/60 hover:bg-gray-800 backdrop-blur-md p-1.5 rounded-full text-white transition-all shadow-sm border border-white/10" title="Toggle Camera">
                    {isCameraOn ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fca5a5" strokeWidth="2.5"><line x1="1" y1="1" x2="23" y2="23" /><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" /></svg>
                    )}
                  </button>
                </div>

                {/* Mobile Camera Toggle Button (Right side of camera view) */}
                <button onClick={toggleCamera} className="min-[1200px]:hidden flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-sm border border-gray-200" style={isCameraOn ? { background: '#f3f4f6', color: '#374151' } : { background: '#fee2e2', color: '#ef4444', borderColor: '#fecaca' }} title="Toggle Camera">
                  {isCameraOn ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M21 21H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3m3-3h6l2 3h4a2 2 0 0 1 2 2v9.34m-7.72-2.06a4 4 0 1 1-5.56-5.56" /></svg>
                  )}
                </button>
              </div>

              {/* Center Bottom: Mute & End Call (Mobile Only) */}
              <div className="min-[1200px]:hidden flex items-center gap-3">
                {/* Mobile Mute */}
                <div className="relative flex items-center justify-center">
                  {showMuteReminder && (
                    <div className="absolute -top-[42px] left-1/2 -translate-x-1/2 bg-gray-800 text-white text-[11px] font-semibold px-3 py-1.5 rounded-lg shadow-lg whitespace-nowrap z-50 pointer-events-none animate-bounce">
                      Hold and say
                      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-gray-800"></div>
                    </div>
                  )}
                  <button onPointerDown={(e) => { e.preventDefault(); toggleMic(true); }} onPointerUp={(e) => { e.preventDefault(); toggleMic(false); }} onPointerLeave={() => toggleMic(false)} onContextMenu={(e) => e.preventDefault()} className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-sm touch-none" style={isMicOn ? { background: '#f3f4f6', color: '#374151' } : { background: '#fee2e2', color: '#ef4444' }} title={isMicOn ? 'Release to Mute' : 'Hold to Speak'}>
                    {isMicOn ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /></svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="1" y1="1" x2="23" y2="23" /><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" /><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
                    )}
                  </button>
                </div>

                {/* Mobile Mute Agent */}
                <button onClick={toggleAgentMute} className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-sm border ${isAgentMuted ? 'bg-orange-50 text-orange-600 border-orange-200' : 'bg-white text-gray-700 border-gray-200'}`} title={isAgentMuted ? "Unmute Agent" : "Mute Agent"}>
                  {isAgentMuted ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
                  )}
                </button>


                {/* Mobile End Call */}
                <button onClick={() => handleLeave()} className="flex-shrink-0 w-12 h-12 rounded-full bg-red-50 hover:bg-red-100 text-red-500 flex items-center justify-center transition-all shadow-sm border border-red-100">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91" /><line x1="23" y1="1" x2="1" y2="23" /></svg>
                </button>
              </div>

              {/* Bottom Right: Agent Card + Remote Tracks */}
              <div className="flex flex-row min-[1200px]:flex-col gap-2 min-[1200px]:gap-4 shrink-0">
                {/* AI Agent Tile */}
                <div className="relative w-12 h-12 min-[1200px]:w-full min-[1200px]:h-auto min-[1200px]:aspect-[4/3] rounded-full min-[1200px]:rounded-[14px] overflow-hidden shrink-0 min-[1200px]:shadow-sm">
                  <AIAgentTile
                    isSpeaking={aiAgentSpeaking}
                    theme={storeConfig?.themeColor || theme}
                    logo={storeConfig?.logo}
                    name={storeConfig?.storeName || 'Assistant'}
                  />
                </div>

                {/* Remote Tracks Container (LiveKit agent video) */}
                <div id="remote-tracks" className="flex flex-row min-[1200px]:flex-col gap-2 min-[1200px]:gap-4 shrink-0 empty:hidden [&>video]:w-12 [&>video]:h-12 min-[1200px]:[&>video]:w-full min-[1200px]:[&>video]:h-auto min-[1200px]:[&>video]:aspect-[4/3] [&>video]:rounded-full min-[1200px]:[&>video]:rounded-[14px] [&>video]:object-cover [&>video]:border [&>video]:border-gray-200 shadow-sm"></div>
              </div>
            </div>

            {/* Desktop Dynamic FAQs (Hidden on Mobile) */}
            <div className="hidden min-[1200px]:flex flex-1 flex-col overflow-y-auto mt-2 space-y-2 pr-1 custom-scrollbar">
              <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3 px-1">Suggested Questions</h3>
              {(agentUIState?.question_for_you?.length > 0 ? agentUIState.question_for_you : suggestionChips)
                .slice(0, 3)
                .map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSendMessage(q)}
                    className="w-full text-left px-3 py-2.5 bg-white border border-gray-200/80 hover:border-indigo-300 hover:shadow-sm rounded-xl text-[13px] text-gray-700 font-medium transition-all group flex items-start gap-2"
                  >
                    <svg className="w-4 h-4 text-indigo-400 mt-0.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span className="leading-snug">{q}</span>
                  </button>
                ))}
            </div>

          </div>
        </div>

      </div>
    </>
  );
}
