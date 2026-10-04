import { requestMicrophoneAudio } from './microphone.js';
import captureURL from '../../workers/conversation-capture-worklet.js?worker&url';
import { SpeechEndpoint } from './endpoint.js';
const aborted = () => new DOMException('Conversation stopped.', 'AbortError');
/** Permission prompts cannot be dismissed by code. Abort the wait, and release
 * any stream granted later without letting it revive the canceled turn. */
export function awaitConversationMicrophone(request, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, stream) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', stop);
      if (error) reject(error);
      else resolve(stream);
    };
    const stop = () => finish(aborted());
    signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(request).then(
      (stream) => {
        if (signal.aborted) {
          stream?.getTracks().forEach((track) => track.stop());
          finish(aborted());
        } else finish(null, stream);
      },
      (error) => finish(error),
    );
    if (signal.aborted) stop();
  });
}
function audioReady(promise, signal) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (error) reject(error);
      else resolve();
    };
    const stop = () => finish(aborted());
    const timer = setTimeout(
      () => finish(new Error('Microphone audio could not start. Resume to try again.')),
      10000,
    );
    signal.addEventListener('abort', stop, { once: true });
    promise.then(() => finish(), finish);
    if (signal.aborted) stop();
  });
}

export async function requestConversationMicrophone({ signal }) {
  if (
    !globalThis.isSecureContext ||
    !navigator.mediaDevices?.getUserMedia ||
    !globalThis.AudioWorkletNode
  )
    throw new Error('Conversation Mode needs HTTPS and local microphone support.');
  const stream = await awaitConversationMicrophone(requestMicrophoneAudio(), signal);
  if (signal.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    throw aborted();
  }
  stream.getTracks().forEach((track) => {
    track.enabled = false;
  });
  return stream;
}

/** Each listening turn owns new tracks; the initial gesture's AudioContext is borrowed. */
export async function createConversationCapture({
  context,
  signal,
  runtime,
  stream,
  onUtterance,
  onError,
}) {
  let source,
    node,
    sink,
    closed = false,
    processing = false;
  const queue = [],
    endpoint = new SpeechEndpoint();
  const revoked = () => {
    cancel();
    onError(new Error('Microphone access ended. Resume to try again.'));
  };
  function cancel() {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', cancel);
    stream?.getTracks().forEach((track) => {
      track.removeEventListener('ended', revoked);
      track.stop();
    });
    source?.disconnect();
    node?.disconnect();
    sink?.disconnect();
    if (node) {
      node.port.onmessage = null;
      node.port.postMessage('stop');
      node.port.close();
    }
    queue.length = 0;
    endpoint.reset();
  }
  signal.addEventListener('abort', cancel, { once: true });
  async function drain() {
    if (processing || closed) return;
    processing = true;
    try {
      while (queue.length && !closed) {
        const pcm = queue.shift();
        const probability = await runtime.detectSpeech(pcm.slice(), { signal });
        if (closed || signal.aborted) return;
        const utterance = endpoint.push(probability, pcm);
        if (utterance?.misfire) await runtime.resetVad({ signal });
        else if (utterance) {
          cancel();
          onUtterance(utterance);
          return;
        }
      }
    } catch (error) {
      if (!closed) {
        cancel();
        onError(error);
      }
    } finally {
      processing = false;
    }
  }
  try {
    if (signal.aborted) throw aborted();
    stream ||= await requestConversationMicrophone({ signal });
    if (closed || signal.aborted) throw aborted();
    await audioReady(context.resume(), signal);
    await audioReady(context.audioWorklet.addModule(captureURL), signal);
    if (closed || signal.aborted) throw aborted();
    if (context.state !== 'running')
      throw new Error('Microphone audio is suspended. Resume Conversation Mode.');
    source = context.createMediaStreamSource(stream);
    node = new globalThis.AudioWorkletNode(context, 'vwl-conversation-capture');
    sink = context.createGain();
    sink.gain.value = 0;
    node.port.onmessage = ({ data }) => {
      if (closed) return;
      queue.push(data);
      if (queue.length > 64) {
        cancel();
        onError(new Error('Voice detection cannot keep up on this device. Try manual dictation.'));
        return;
      }
      void drain();
    };
    for (const track of stream.getTracks()) {
      track.addEventListener('ended', revoked);
      track.enabled = true;
    }
    source.connect(node).connect(sink).connect(context.destination);
    return { cancel };
  } catch (error) {
    // A late permission grant still belongs to this canceled turn.
    stream?.getTracks().forEach((track) => track.stop());
    cancel();
    throw error;
  }
}
