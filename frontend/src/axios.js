import axios from 'axios'

const instance = axios.create({
  baseURL: '/api',
  timeout: 60000, // 问答要调 Embedding + 大模型，适当放宽
})

instance.interceptors.request.use(
  (config) => {
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

instance.interceptors.response.use(
  (response) => {
    if(response.status === 200) {
      return response.data
    }
    return Promise.reject(response.data)
  },
  (error) => {
    return Promise.reject(error)
  }
)

export default instance