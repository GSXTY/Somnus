import type { ProviderApi } from '../chat/assistantApi';

// Endpoints and credential names from DSH Next f2483c6 provider-data.generated.ts.
export const providerCatalog: { id: string; name: string; baseUrl: string; api?: ProviderApi; env?: string }[] = [
  { id: 'amazon-bedrock', name: 'AWS Bedrock', baseUrl: '', api: 'bedrock-converse-stream', env: 'AWS_BEARER_TOKEN_BEDROCK' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', api: 'anthropic-messages', env: 'ANTHROPIC_API_KEY' },
  {
    "id": "baseten",
    "env": "BASETEN_API_KEY",
    "name": "Baseten",
    "baseUrl": "https://inference.baseten.co/v1"
  },
  {
    "id": "cerebras",
    "env": "CEREBRAS_API_KEY",
    "name": "Cerebras",
    "baseUrl": "https://api.cerebras.ai/v1"
  },
  {
    "id": "deepseek",
    "env": "DEEPSEEK_API_KEY",
    "name": "DeepSeek",
    "baseUrl": "https://api.deepseek.com"
  },
  {
    "id": "groq",
    "env": "GROQ_API_KEY",
    "name": "Groq",
    "baseUrl": "https://api.groq.com/openai/v1"
  },
  {
    "id": "huggingface",
    "env": "HF_TOKEN",
    "name": "Hugging Face",
    "baseUrl": "https://router.huggingface.co/v1"
  },
  {
    "id": "moonshot-cn",
    "env": "MOONSHOT_API_KEY",
    "name": "Moonshot AI（中国）",
    "baseUrl": "https://api.moonshot.cn/v1"
  },
  {
    "id": "moonshot",
    "env": "MOONSHOT_API_KEY",
    "name": "Moonshot AI（国际）",
    "baseUrl": "https://api.moonshot.ai/v1"
  },
  {
    "id": "nvidia",
    "env": "NVIDIA_API_KEY",
    "name": "NVIDIA",
    "baseUrl": "https://integrate.api.nvidia.com/v1"
  },
  {
    "id": "openai",
    "env": "OPENAI_API_KEY",
    "name": "OpenAI",
    "baseUrl": "https://api.openai.com/v1"
  },
  {
    "id": "openrouter",
    "env": "OPENROUTER_API_KEY",
    "name": "OpenRouter",
    "baseUrl": "https://openrouter.ai/api/v1"
  },
  {
    "id": "together",
    "env": "TOGETHER_API_KEY",
    "name": "Together AI",
    "baseUrl": "https://api.together.ai/v1"
  },
  {
    "id": "xai",
    "env": "XAI_API_KEY",
    "name": "xAI",
    "baseUrl": "https://api.x.ai/v1"
  },
  {
    "id": "xiaomi",
    "env": "XIAOMI_API_KEY",
    "name": "小米 MiMo",
    "baseUrl": "https://api.xiaomimimo.com/v1"
  }
];
