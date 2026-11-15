import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import MeetingPage from './MeetingPage.jsx'

// StrictMode intentionally removed — it double-mounts in dev, which causes
// LiveKit / WebRTC to open duplicate connections and device streams.

// No router in this app: a `?token=` in the URL means "join a shared meeting
// link" (token here is the user's own access_token, exchanged for an
// ai_call_token by MeetingPage/useValidateCall) and renders the intermediate
// generate_ai_session -> validate_call_token -> generate_meeting_token -> join
// page. Everything else is the normal phone/OTP + AI-agent widget.
createRoot(document.getElementById('root')).render(
  <App />
);
