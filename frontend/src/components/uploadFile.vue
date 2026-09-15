<script setup>
import { Document } from '@element-plus/icons-vue';
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

const emits = defineEmits(['update:fileList'])
const fileList = ref([])
const beforeUpload = (file) => {
  if(file.type !== 'text/plain' && file.type !== 'text/markdown') {
    ElMessage.error('请上传txt或md文件')
    return false
  }
  
  return true
}
const handleSuccess = (response) => {
  if(response.code !== 200) {
    ElMessage.error(response.message)
    return
  }
  ElMessage.success(response.message)
  fileList.value.push({
    name: response.filename,
    url: response.savedAs,
  })
  emits('update:fileList', fileList.value)
}
const handleError = (error) => {
  ElMessage.error(error.message)
}
</script>
<template>
  <el-upload
    class="upload-inline"
    action="/api/uploadFile"
    :file-list="fileList"
    :show-file-list="false"
    :on-success="handleSuccess"
    :on-error="handleError"
    :before-upload="beforeUpload"
  >
    <el-button class="select-btn" :icon="Document">
      导入文档
    </el-button>
  </el-upload>
</template>
<style scoped lang="less">
.upload-inline {
  :deep(.el-upload) {
    display: inline-flex;
  }
}

.select-btn {
  --el-button-bg-color: #e8f4ff;
  --el-button-text-color: #1664c4;
  --el-button-border-color: #b7d8f8;
  --el-button-hover-bg-color: #d6ebff;
  --el-button-hover-text-color: #0d4ea0;
  --el-button-hover-border-color: #7eb8f0;
  height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  font-size: 13px;
}
</style>
