/** Explain native capture failures; never replace local capture with a remote recognizer. */
export async function requestMicrophoneAudio() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (error) {
    const messages = {
      NotFoundError:
        'No microphone input is available in this browser. Connect or enable a microphone. If you are using an in-app browser, open this page in desktop Chrome and allow microphone access.',
      NotAllowedError:
        'Microphone access was denied. Allow microphone access for this site and browser in your browser and system settings, then try again.',
      NotReadableError:
        'The microphone could not be opened. Check that it is connected and available, close other apps using it if necessary, then try again.',
      SecurityError:
        'Microphone access is disabled in this browser. Enable microphone access or open this page in desktop Chrome.',
      OverconstrainedError:
        'The microphone does not support the requested audio settings. Try another microphone or open this page in desktop Chrome.',
    };
    if (!messages[error?.name]) throw error;
    const explained = new Error(messages[error.name], { cause: error });
    explained.name = error.name;
    throw explained;
  }
}
