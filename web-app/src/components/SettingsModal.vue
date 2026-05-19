<template>
  <Teleport to="body">
    <div class="settings-modal" @click.self="$emit('close')">
      <div class="modal-content">
        <div class="modal-header">
          <h3>⚙️ 连接设置</h3>
          <button class="close-btn" @click="$emit('close')">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>Max FPS (0 为无限制):</label>
            <input type="number" v-model.number="localSettings.fps" min="0" max="120" />
          </div>

          <div class="form-group">
            <label>Max Size (0 为无限制):</label>
            <input type="number" v-model.number="localSettings.size" min="0" step="100" />
            <small class="hint">例如：1080 表示限制最长边为 1080</small>
          </div>

          <div class="form-group">
            <label>开启 BWE (动态码率):</label>
            <div class="toggle-switch">
              <input type="checkbox" id="bwe-toggle" v-model="localSettings.bwe" />
              <label for="bwe-toggle"></label>
            </div>
          </div>

          <div class="form-group" v-if="localSettings.bwe">
            <label>Min Bitrate (Mbps):</label>
            <input type="number" v-model.number="localSettings.minBitrate" min="1" step="1" />
            <small class="hint">默认：8 Mbps</small>
          </div>

          <div class="form-group" v-if="localSettings.bwe">
            <label>Max Bitrate (Mbps):</label>
            <input type="number" v-model.number="localSettings.maxBitrate" min="1" step="1" />
            <small class="hint">默认：20 Mbps</small>
          </div>
          
          <div class="form-group" v-if="!localSettings.bwe">
            <label>Bitrate (Mbps):</label>
            <input type="number" v-model.number="localSettings.bitrate" min="1" step="1" />
            <small class="hint">默认：4 Mbps</small>
          </div>

          <div class="form-group">
            <label>开启 Agent Debug 日志:</label>
            <div class="toggle-switch">
              <input type="checkbox" id="debug-toggle" v-model="localSettings.debug" />
              <label for="debug-toggle"></label>
            </div>
          </div>

          <div class="form-group">
            <label>开启音频 (Opus):</label>
            <div class="toggle-switch">
              <input type="checkbox" id="audio-toggle" v-model="localSettings.audio" />
              <label for="audio-toggle"></label>
            </div>
          </div>

          <div class="form-group" v-if="localSettings.audio">
            <label>音量增益:</label>
            <input type="number" v-model.number="localSettings.audioGain" min="0.5" max="3" step="0.25" />
            <small class="hint">默认：1，过高可能失真</small>
          </div>

          <div class="form-group" v-if="localSettings.audio">
            <label>音频源:</label>
            <select v-model="localSettings.audioSource">
              <option value="playback">playback</option>
              <option value="output">output</option>
            </select>
            <small class="hint" v-if="localSettings.audioSource === 'playback'">不抢占手机本地声音，但只能捕获允许播放捕获的应用声音</small>
            <small class="hint" v-else>捕获系统输出更完整，但会接管手机本地声音</small>
          </div>

          <div class="form-group" v-if="localSettings.audio && localSettings.audioSource === 'playback'">
            <label>保留手机本地声音:</label>
            <div class="toggle-switch">
              <input type="checkbox" id="audio-dup-toggle" v-model="localSettings.audioDup" />
              <label for="audio-dup-toggle"></label>
            </div>
            <small class="hint">仅 playback 模式有效；关闭后可能仍由系统路由决定是否本机出声</small>
          </div>

          <div class="form-group" v-if="localSettings.audio">
            <label>默认页面静音:</label>
            <div class="toggle-switch">
              <input type="checkbox" id="page-audio-muted-toggle" v-model="localSettings.pageAudioMuted" />
              <label for="page-audio-muted-toggle"></label>
            </div>
            <small class="hint">只静音浏览器播放，不修改虚机系统音量</small>
          </div>

        </div>
        <div class="modal-footer">
          <button class="btn btn-danger" v-if="isCustom" @click="resetToGlobal">恢复全局设置</button>
          <div style="flex: 1"></div>
          <button class="btn btn-secondary" @click="$emit('close')">取消</button>
          <button class="btn btn-primary" @click="saveAndReconnect">
            {{ isGlobal ? '保存全局设置' : (isConnected ? '保存并重新连接' : '保存并连接') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  settings: {
    type: Object,
    required: true
  },
  isConnected: {
    type: Boolean,
    default: false
  },
  isGlobal: {
    type: Boolean,
    default: false
  },
  isCustom: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['close', 'save', 'reset'])

const localSettings = ref({ ...props.settings })

function saveAndReconnect() {
  emit('save', { ...localSettings.value })
  emit('close')
}

function resetToGlobal() {
  emit('reset')
  emit('close')
}
</script>

<style scoped>
.settings-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
  animation: fadeIn 0.2s ease;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.modal-content {
  background: var(--bg-secondary);
  border-radius: 12px;
  width: 100%;
  max-width: 400px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}

.modal-header h3 {
  margin: 0;
  font-size: 16px;
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-secondary);
  font-size: 24px;
  border-radius: 8px;
  cursor: pointer;
  border: none;
}

.close-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-primary);
}

.modal-body {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.form-group {
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-group label {
  font-size: 13px;
  color: var(--text-secondary);
}

.form-group input[type="number"], .form-group input[type="text"], .form-group select {
  background: var(--bg-primary);
  border: 1px solid var(--border);
  padding: 10px;
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 14px;
}

.form-group input:focus {
  outline: none;
  border-color: var(--accent);
}

.hint {
  font-size: 12px;
  color: #8b949e;
}

.toggle-switch {
  display: flex;
  align-items: center;
}

.toggle-switch input[type="checkbox"] {
  display: none;
}

.toggle-switch label {
  cursor: pointer;
  width: 40px;
  height: 20px;
  background: var(--border);
  border-radius: 10px;
  position: relative;
  transition: background-color 0.2s;
}

.toggle-switch label::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-switch input[type="checkbox"]:checked + label {
  background: var(--accent);
}

.toggle-switch input[type="checkbox"]:checked + label::after {
  transform: translateX(20px);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid var(--border);
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn-primary {
  background: var(--accent);
  color: white;
}

.btn-primary:hover {
  filter: brightness(1.1);
}

.btn-danger {
  background: transparent;
  color: #f85149;
  border: 1px solid #f85149;
}

.btn-danger:hover {
  background: rgba(248, 81, 73, 0.1);
}
</style>
