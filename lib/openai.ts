import OpenAI from 'openai'
import { getActiveGatewayConnection } from './openclaw-connection-server'

export function getOpenAIClient(): OpenAI {
  const gateway = getActiveGatewayConnection()
  return new OpenAI({
    baseURL: gateway.baseUrl,
    apiKey: gateway.token,
  })
}
