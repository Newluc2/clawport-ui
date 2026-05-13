import OpenAI from 'openai'
import { getConnectionById, getLocalConnection } from './connections'

export function getOpenAIClient(): OpenAI {
  const gateway = getLocalConnection()
  return new OpenAI({
    baseURL: `${gateway.gatewayUrl}/v1`,
    apiKey: gateway.gatewayToken,
  })
}

export function getOpenAIClientForConnection(connectionId?: string): OpenAI {
  const connection = (connectionId && getConnectionById(connectionId)) || getLocalConnection()
  return new OpenAI({
    baseURL: `${connection.gatewayUrl}/v1`,
    apiKey: connection.gatewayToken,
  })
}
