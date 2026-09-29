/*
  {
    id: '时间戳',
    title: '新对话',          // 可用首条用户问题截断
    updatedAt: 1710000000000,
    messages: [  同页面 messages，可含 citations  ]
  }
*/
const CURRENT_KEY = 'currentConversationId'
export const getCurrentId = () => localStorage.getItem(CURRENT_KEY)
export const setCurrentId = (id) => {
  if (id == null) localStorage.removeItem(CURRENT_KEY)
  else localStorage.setItem(CURRENT_KEY, String(id))
}
// 获取数据
export const getDataList = () => {
  return JSON.parse(localStorage.getItem('dataList') || '[]')
}
// 新增数据
export const createData = (id, data) => {
  const originData = getDataList()
  originData.push({ id, ...data })
  localStorage.setItem('dataList', JSON.stringify(originData))
  // 设置当前对话id
  setCurrentId(id)
}

// 删除某条数据
export const delData = (id) => {
  const originData = getDataList()
  const index = originData.findIndex(item => Number(item.id) === Number(id))
  if (index === -1) return;
  originData.splice(index, 1)
  localStorage.setItem('dataList', JSON.stringify(originData))
}

// 更新某条数据
export const updateData = (id, data) => {
  const originData = getDataList()
  const index = originData.findIndex(item => Number(item.id) === Number(id))
  originData[index] = { ...originData[index], ...data }
  localStorage.setItem('dataList', JSON.stringify(originData))
}