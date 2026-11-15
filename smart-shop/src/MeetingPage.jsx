import { useValidateCall } from './hooks/useValidateCall';
import { useLiveKitRoom } from './hooks/useLiveKitRoom';
import MeetingView from './components/MeetingView';


export default function MeetingPage() {
  const {
    phase,
    setPhase,
    errMsg,
    setErrMsg,
    callToken,
    userName,
    setUserName,
    meetingDetails,
    setMeetingDetails,
  } = useValidateCall();

  const {
    localVideoRef,
    participants,
    isMicOn,
    isCameraOn,
    isScreenSharing,
    viewMode,
    handleJoinRoom,
    toggleMic,
    toggleCamera,
    toggleScreenShare,
    toggleViewMode,
    handleLeave,
  } = useLiveKitRoom({
    phase,
    setPhase,
    setErrMsg,
    callToken,
    setUserName,
    setMeetingDetails,
  });

  return (
    <MeetingView
      phase={phase}
      errMsg={errMsg}
      userName={userName}
      meetingDetails={meetingDetails}
      localVideoRef={localVideoRef}
      participants={participants}
      isMicOn={isMicOn}
      isCameraOn={isCameraOn}
      isScreenSharing={isScreenSharing}
      viewMode={viewMode}
      handleJoinRoom={handleJoinRoom}
      toggleMic={toggleMic}
      toggleCamera={toggleCamera}
      toggleScreenShare={toggleScreenShare}
      toggleViewMode={toggleViewMode}
      handleLeave={handleLeave}
    />
  );
}
