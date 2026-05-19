import { ref, onUnmounted } from 'vue'
import { useDeviceStore } from '@/stores/devices'
import { debugInfo, debugLog, debugWarn } from '@/utils/debug'

export function useWebRTC(deviceId, options = {}) {
  const status = ref('disconnected')
  const error = ref(null)
  const audioMuted = ref(false)

  let ws = null
  let pc = null
  let iceServers = [{ urls: 'stun:stun.l.google.com:19302' }]
  let inputChannel = null
  let adbChannel = null
  let videoElementGetter = null  // 获取 video 元素的函数
  let videoStream = null
  let audioStream = null
  let audioElement = null
  let audioContext = null
  let audioSourceNode = null
  let audioGainNode = null
  let audioUnlockHandler = null
  let touchSeq = 0
  const DEVICE_W = ref(1080)
  const DEVICE_H = ref(1920)

  function connect() {
    status.value = 'connecting'
    error.value = null

    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    // 如果在开发模式（端口 3000），使用当前 host，依靠 Vite 代理
    const wsUrl = `${wsProtocol}//${location.host}/connect_client`
    
    debugLog('[Signaling] Connecting to:', wsUrl)
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      debugLog('[Signaling] WebSocket connected')
      status.value = 'signaling'
      ws.send(JSON.stringify({
        message_type: 'connect',
        device_id: deviceId
      }))
    }

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        debugLog('[Signaling] Received:', msg.message_type || msg.type, msg)
        handleMessage(msg)
      } catch (e) {
        console.error('[Signaling] Failed to parse message:', e, evt.data)
      }
    }

    ws.onerror = (e) => {
      error.value = 'WebSocket error'
      status.value = 'error'
      console.error('WebSocket error:', e)
    }

    ws.onclose = () => {
      debugLog('[Signaling] WebSocket closed')
      if (status.value !== 'disconnected') {
        status.value = 'disconnected'
      }
    }
  }

  function handleMessage(msg) {
    const type = msg.message_type || msg.type
    switch (type) {
      case 'config':
        status.value = 'waiting_offer'
        if (msg.ice_servers && msg.ice_servers.length > 0) {
          iceServers = msg.ice_servers
          debugLog('[WebRTC] ICE Servers updated from config:', iceServers)
        }
        // 发送 request-offer 请求
        const offerPayload = { type: 'request-offer' }
        if (Object.keys(options).length > 0) {
          offerPayload.scrcpy_options = options
        }
        sendForward(offerPayload)
        break
      case 'device_info':
        handleDeviceInfo(msg.device_info)
        break
      case 'device_msg':
        handleDeviceMessage(msg.payload)
        break
      case 'screenshot_response':
        handleScreenshot(msg.data)
        break
      case 'error':
        error.value = msg.error || 'Server error'
        status.value = 'error'
        break
    }
  }

  function handleDeviceInfo(info) {
    if (info && info.displays && info.displays.length > 0) {
      const display = info.displays[0]
      DEVICE_W.value = display.x_res || 1080
      DEVICE_H.value = display.y_res || 1920
      debugLog(`[WebRTC] Device dimensions updated: ${DEVICE_W.value}x${DEVICE_H.value}`)
    }
  }
function handleDeviceMessage(payload) {
  if (!payload || !payload.type) return

  switch (payload.type) {
    case 'offer':
      debugLog('[WebRTC] Received offer, length:', payload.sdp.length)
      createPeerConnection()
      pc.setRemoteDescription(new RTCSessionDescription({
        type: 'offer',
        sdp: payload.sdp
      }))
        .then(() => pc.createAnswer())
        .then(answer => {
          // 重新启用 SDP Munging：这次使用正确的单位 (bps)
          let sdp = answer.sdp;
          // 1. 设置带宽 AS (kbps) 为 20000 = 20Mbps
          sdp = sdp.replace(/m=video (.*)\r\n/g, `m=video $1\r\nb=AS:20000\r\n`);
          // 2. 针对常见 H.264 profile 设置 google 特有参数 (bps) 20000000 = 20Mbps
          sdp = sdp.replace(/a=fmtp:(102|96) (.*)\r\n/g, `a=fmtp:$1 $2;x-google-start-bitrate=20000000;x-google-max-bitrate=20000000\r\n`);

          const newAnswer = new RTCSessionDescription({
            type: 'answer',
            sdp: sdp
          });
          debugLog('[WebRTC] Answer SDP munged to 20Mbps (bps)')
          return pc.setLocalDescription(newAnswer);
        })
        .then(() => {
          // 等待 ICE 收集完成
          if (pc.iceGatheringState === 'complete') {
            sendAnswer()
          } else {
              const checkIce = () => {
                if (pc.iceGatheringState === 'complete') {
                  pc.removeEventListener('icegatheringstatechange', checkIce)
                  sendAnswer()
                }
              }
              pc.addEventListener('icegatheringstatechange', checkIce)
              // 设置超时，防止等待过久
              setTimeout(() => {
                pc.removeEventListener('icegatheringstatechange', checkIce)
                if (status.value === 'connecting_webrtc') {
                  sendAnswer()
                }
              }, 2000)
            }
            status.value = 'connecting_webrtc'
          })
          .catch(e => {
            error.value = 'SDP error: ' + e.message
            console.error('SDP error:', e)
          })
        break

      case 'ice-candidate':
        if (pc && payload.candidate) {
          debugLog('[WebRTC] Received remote ICE candidate')
          pc.addIceCandidate(new RTCIceCandidate(payload.candidate))
            .catch(e => console.warn('ICE error:', e))
        }
        break

      case 'command_result':
        handleCommandResult(payload)
        break
    }
  }

  function sendCommand(command) {
    const requestId = Math.random().toString(36).substring(7)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        message_type: 'command',
        device_id: deviceId,
        request_id: requestId,
        command: command
      }))
    }
    return requestId
  }

  let commandCallback = null
  function onCommandResult(callback) {
    commandCallback = callback
  }

  function handleCommandResult(result) {
    if (commandCallback) {
      commandCallback(result)
    }
  }

  function sendAnswer() {
    if (!pc || !pc.localDescription) return
    debugLog('[WebRTC] Sending answer')
    sendForward({
      type: 'answer',
      sdp: pc.localDescription.sdp
    })
  }

  function getAudioGain() {
    const value = Number(options.audio_gain ?? options.audioGain ?? 1)
    if (!Number.isFinite(value)) return 1
    return Math.max(0, Math.min(5, value))
  }

  function getAudioLowLatency() {
    return Boolean(options.audio_low_latency ?? options.audioLowLatency)
  }

  function clearAudioUnlockHandler() {
    if (audioUnlockHandler) {
      window.removeEventListener('pointerdown', audioUnlockHandler)
      window.removeEventListener('keydown', audioUnlockHandler)
      audioUnlockHandler = null
    }
  }

  function cleanupAudioPlayback() {
    clearAudioUnlockHandler()
    if (audioSourceNode) {
      audioSourceNode.disconnect()
      audioSourceNode = null
    }
    if (audioGainNode) {
      audioGainNode.disconnect()
      audioGainNode = null
    }
    if (audioContext) {
      audioContext.close().catch(() => {})
      audioContext = null
    }
    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
      audioElement = null
    }
    audioStream = null
  }

  function playAudioElement(gain) {
    if (!audioStream) return

    clearAudioUnlockHandler()

    if (audioElement) {
      audioElement.pause()
      audioElement.srcObject = null
    }

    audioElement = new Audio()
    audioElement.autoplay = true
    audioElement.playsInline = true
    audioElement.muted = audioMuted.value
    audioElement.volume = Math.min(1, gain)
    audioElement.srcObject = audioStream

    const play = () => {
      if (!audioElement) return
      audioElement.play()
        .then(() => {
          debugLog('[WebRTC] Audio element playing, volume:', audioElement.volume)
          if (audioUnlockHandler) {
            window.removeEventListener('pointerdown', audioUnlockHandler)
            window.removeEventListener('keydown', audioUnlockHandler)
            audioUnlockHandler = null
          }
        })
        .catch(err => {
          debugWarn('[WebRTC] audio play() blocked, waiting for user gesture:', err)
          if (!audioUnlockHandler) {
            audioUnlockHandler = () => play()
            window.addEventListener('pointerdown', audioUnlockHandler, { once: true })
            window.addEventListener('keydown', audioUnlockHandler, { once: true })
          }
        })
    }

    audioElement.addEventListener('canplay', play, { once: true })
    audioElement.addEventListener('playing', () => {
      debugLog('[WebRTC] audio element state=playing')
    })
    audioElement.addEventListener('error', () => {
      console.warn('[WebRTC] audio element error:', audioElement?.error)
    })
    play()
  }

  function playAudioTrack(track) {
    if (!options.audio) return

    cleanupAudioPlayback()
    audioStream = new MediaStream([track])
    const gain = getAudioGain()

    if (getAudioLowLatency()) {
      debugWarn('[WebRTC] Low latency audio experiment is disabled for now; using audio element playback')
    }
    playAudioElement(gain)

    if (track.addEventListener) {
      track.addEventListener('ended', cleanupAudioPlayback, { once: true })
    }
  }

  function createPeerConnection() {
    if (pc) return

    debugLog('[WebRTC] Creating RTCPeerConnection with servers:', iceServers)
    pc = new RTCPeerConnection({
      iceServers: iceServers
    })

    // 创建 ADB 通道 (主动创建)
    adbChannel = pc.createDataChannel('adb-channel', { ordered: true })
    adbChannel.binaryType = 'arraybuffer' // 必须设置为 arraybuffer 以支持二进制流
    setupAdbChannel(adbChannel)
    videoStream = new MediaStream()

    pc.ontrack = (evt) => {
      debugLog('[WebRTC] ontrack event:', evt.track.kind, evt.streams)
      if (evt.track.kind === 'audio') {
        playAudioTrack(evt.track)
        return
      }

      const video = videoElementGetter ? videoElementGetter() : null
      if (video) {
        if (!videoStream) videoStream = new MediaStream()
        const exists = videoStream.getTracks().some(track => track.id === evt.track.id)
        if (!exists) {
          videoStream.addTrack(evt.track)
        }
        video.srcObject = videoStream
        debugLog('[WebRTC] Set srcObject to video element')
        // 强制播放
        video.play().catch(e => console.warn('[WebRTC] play() failed:', e))
      } else {
        console.error('[WebRTC] videoElement is null!')
      }
    }

    pc.onicecandidate = (evt) => {
      if (evt.candidate) {
        sendForward({
          type: 'ice-candidate',
          candidate: {
            candidate: evt.candidate.candidate,
            sdpMid: evt.candidate.sdpMid,
            sdpMLineIndex: evt.candidate.sdpMLineIndex
          }
        })
      }
    }

    pc.oniceconnectionstatechange = () => {
      debugLog('[WebRTC] ICE Connection State:', pc.iceConnectionState)
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        status.value = 'connected'
      } else if (pc.iceConnectionState === 'failed') {
        error.value = 'ICE connection failed'
        status.value = 'error'
      }
    }

    pc.onconnectionstatechange = () => {
      debugLog('[WebRTC] Connection State:', pc.connectionState)
      if (pc.connectionState === 'connected') {
        status.value = 'connected'
      } else if (pc.connectionState === 'failed') {
        error.value = 'WebRTC connection failed'
        status.value = 'error'
      } else if (pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        status.value = 'disconnected'
      }
    }

    pc.ondatachannel = (evt) => {
      debugLog('[WebRTC] Received DataChannel:', evt.channel.label)
      if (evt.channel.label === 'input-channel') {
        inputChannel = evt.channel
        inputChannel.onopen = () => {
          debugLog('[DataChannel] input-channel OPEN')
        }
        inputChannel.onclose = () => {
          debugLog('[DataChannel] input-channel CLOSED')
        }
        inputChannel.onerror = (e) => console.error('[DataChannel] Error:', e)
      }
    }
  }

  // --- 统计监控逻辑 ---
  let prevStats = { timestamp: 0, bytesReceived: 0, framesDecoded: 0 }
  let pauseCount = 0
  let wasPaused = false

  async function getVideoStats() {
    if (!pc) return null
    try {
      const stats = await pc.getStats()
      let currentRtt = 0
      
      // First pass to find RTT from candidate pair
      for (const report of stats.values()) {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          currentRtt = (report.currentRoundTripTime || 0) * 1000
        }
      }

      for (const report of stats.values()) {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          const now = report.timestamp
          const dt = prevStats.timestamp ? (now - prevStats.timestamp) / 1000 : 0

          const newFrames = report.framesDecoded - prevStats.framesDecoded
          const fps = dt > 0 ? (newFrames / dt).toFixed(0) : 0

          if (dt > 0 && newFrames === 0 && !wasPaused && status.value === 'connected') {
            pauseCount++
            wasPaused = true
            debugWarn('[VideoTrace] decode-pause', {
              pauseCount,
              ts: Date.now(),
              dtMs: Math.round(dt * 1000),
              framesDecoded: report.framesDecoded,
              bytesReceived: report.bytesReceived,
              pliCount: report.pliCount || 0,
              packetsLost: report.packetsLost || 0,
              jitterBufferDelay: report.jitterBufferDelay,
              jitterBufferEmittedCount: report.jitterBufferEmittedCount
            })
          } else if (newFrames > 0) {
            if (wasPaused) {
              debugInfo('[VideoTrace] decode-resume', {
                ts: Date.now(),
                newFrames,
                framesDecoded: report.framesDecoded,
                pliCount: report.pliCount || 0,
                packetsLost: report.packetsLost || 0
              })
            }
            wasPaused = false
          }

          const bitrate = dt > 0 ? ((report.bytesReceived - prevStats.bytesReceived) * 8 / dt / 1000).toFixed(0) : 0
          const jbDelayNum = (report.jitterBufferDelay / (report.jitterBufferEmittedCount || 1) * 1000) || 0
          const jbDelay = jbDelayNum.toFixed(0)
          
          // Estimate E2E latency: RTT (network) + JB (buffer) + Decode (client) + 10ms (server processing)
          const decodeTimeNum = (report.totalDecodeTime / (report.framesDecoded || 1) * 1000) || 0
          const e2eDelay = (currentRtt + jbDelayNum + decodeTimeNum + 10).toFixed(0)

          const pliCount = report.pliCount || 0
          const lostCount = report.packetsLost || 0

          prevStats = {
            timestamp: now,
            bytesReceived: report.bytesReceived,
            framesDecoded: report.framesDecoded
          }

          return { fps, bitrate, jbDelay, e2eDelay, rtt: currentRtt.toFixed(0), pliCount, pauseCount, lostCount }
        }
      }
    } catch (e) {
      // ignore
    }
    return null
  }

  function resetStats() {
    prevStats = { timestamp: 0, bytesReceived: 0, framesDecoded: 0 }
    pauseCount = 0
    wasPaused = false
  }

  function setAudioMuted(muted) {
    audioMuted.value = Boolean(muted)
    if (audioElement) {
      audioElement.muted = audioMuted.value
    }
  }

  function toggleAudioMuted() {
    setAudioMuted(!audioMuted.value)
    return audioMuted.value
  }

  function sendForward(payload) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        message_type: 'forward',
        device_id: deviceId,
        payload
      }))
    }
  }

  function sendTouch(action, clientX, clientY, id = 0, rotatedCoord = null) {
    if (!inputChannel || inputChannel.readyState !== 'open') return
    const video = videoElementGetter ? videoElementGetter() : null
    if (!video || !video.videoWidth || !video.videoHeight) return
    const seq = ++touchSeq
    const clientTsMs = Date.now()

    const videoW = video.videoWidth
    const videoH = video.videoHeight
    const isVideoLandscape = videoW > videoH
    const targetW = isVideoLandscape ? DEVICE_H.value : DEVICE_W.value
    const targetH = isVideoLandscape ? DEVICE_W.value : DEVICE_H.value

    let finalX, finalY

    // 如果提供了预计算的旋转坐标，直接使用
    if (rotatedCoord && rotatedCoord.isRotated) {
      // rotatedCoord.x/y 是相对于原始视频尺寸的坐标
      // 映射到设备分辨率
      const x = Math.round(rotatedCoord.x / videoW * targetW)
      const y = Math.round(rotatedCoord.y / videoH * targetH)
      finalX = Math.max(0, Math.min(targetW, x))
      finalY = Math.max(0, Math.min(targetH, y))
    } else {
      // 正常计算
      const rect = video.getBoundingClientRect()
      const clientW = rect.width
      const clientH = rect.height

      // 计算 object-fit: contain 下视频实际显示的尺寸和偏移
      const videoRatio = videoW / videoH
      const clientRatio = clientW / clientH

      let actualW, actualH, offsetX, offsetY
      if (clientRatio > videoRatio) {
        // 左右有黑边 (Pillarbox)
        actualH = clientH
        actualW = clientH * videoRatio
        offsetX = (clientW - actualW) / 2
        offsetY = 0
      } else {
        // 上下有黑边 (Letterbox)
        actualW = clientW
        actualH = clientW / videoRatio
        offsetX = 0
        offsetY = (clientH - actualH) / 2
      }

      // 计算相对于实际视频内容的坐标
      const relativeX = clientX - rect.left - offsetX
      const relativeY = clientY - rect.top - offsetY

      // 映射到设备分辨率
      const x = Math.round(relativeX / actualW * targetW)
      const y = Math.round(relativeY / actualH * targetH)

      // 越界检查
      finalX = Math.max(0, Math.min(targetW, x))
      finalY = Math.max(0, Math.min(targetH, y))
    }

    const msg = JSON.stringify({
      type: 'touch',
      id,
      seq,
      client_ts_ms: clientTsMs,
      action,
      x: finalX,
      y: finalY,
      w: targetW,
      h: targetH
    })

    const bufferedBefore = inputChannel.bufferedAmount
    inputChannel.send(msg)
    const bufferedAfter = inputChannel.bufferedAmount
    if (action !== 2 || seq % 30 === 0 || bufferedAfter > 65536) {
      debugInfo('[TouchTrace] dc-send', {
        seq,
        action,
        id,
        x: finalX,
        y: finalY,
        w: targetW,
        h: targetH,
        clientTsMs,
        bufferedBefore,
        bufferedAfter
      })
    }
  }

  function requestScreenshot() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        message_type: 'screenshot_request',
        device_id: deviceId
      }))
    }
  }

  let screenshotCallback = null

  function onScreenshot(callback) {
    screenshotCallback = callback
  }

  function handleScreenshot(data) {
    if (screenshotCallback) {
      screenshotCallback(data)
    }
  }

  function setupAdbChannel(channel) {
    channel.onopen = () => {
      debugLog('[ADB] DataChannel OPEN')
    }
    channel.onmessage = (evt) => {
      // console.log('[ADB] DataChannel Message Received:', evt.data.byteLength, 'bytes')
      if (adbDataCallback) {
        adbDataCallback(evt.data)
      } else {
        debugLog('[ADB] Buffering data packet:', evt.data.byteLength, 'bytes')
        adbDataBuffer.push(evt.data)
      }
    }
    channel.onclose = () => {
      debugLog('[ADB] DataChannel CLOSED')
    }
    channel.onerror = (e) => console.error('[ADB] DataChannel Error:', e)
  }

  let adbDataCallback = null
  let adbDataBuffer = [] // 数据缓冲区

  function onAdbData(callback) {
    adbDataCallback = callback
    if (!callback) {
      adbDataBuffer = [] // 如果清空回调，也清空缓冲区
      return
    }
    // 立即处理缓冲中的数据
    if (adbDataBuffer.length > 0) {
      debugLog(`[ADB] Flushing ${adbDataBuffer.length} buffered packets`)
      adbDataBuffer.forEach(data => callback(data))
      adbDataBuffer = []
    }
  }

  function sendAdbData(data) {
    if (adbChannel && adbChannel.readyState === 'open') {
      // 严格检查并确保发送二进制数据
      if (data instanceof Uint8Array || data instanceof ArrayBuffer) {
        adbChannel.send(data)
      } else if (data && data.buffer instanceof ArrayBuffer) {
        // 自动提取底层 ArrayBuffer
        const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        adbChannel.send(buffer)
      } else {
        console.error('[ADB] Fatal: sendAdbData received non-binary object, blocking send:', data)
      }
    }
  }

  function disconnect() {
    if (pc) {
      pc.close()
      pc = null
    }
    videoStream = null
    cleanupAudioPlayback()
    if (ws) {
      ws.close()
      ws = null
    }
    status.value = 'disconnected'
  }

  onUnmounted(() => {
    disconnect()
  })

  // 设置获取视频元素的函数 (由组件调用)
  function setVideoGetter(getter) {
    videoElementGetter = getter
  }

  return {
    status,
    error,
    audioMuted,
    setVideoGetter,
    connect,
    disconnect,
    sendTouch,
    requestScreenshot,
    onScreenshot,
    sendCommand,
    onCommandResult,
    onAdbData,
    sendAdbData,
    getVideoStats,
    resetStats,
    setAudioMuted,
    toggleAudioMuted
  }
}
