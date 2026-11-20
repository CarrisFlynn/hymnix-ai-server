export type CatalogEntry = {
  name: string;
  publisher: string;
  aliases: readonly string[];
  downloadGb: number;
  license: string;
  licenseKind: "permissive" | "open-weight" | "other";
  use: "Chat" | "Reasoning" | "Coding" | "Vision" | "Embeddings";
};

type Variant = readonly [
  tag: string, downloadGb: number, license: string, licenseKind: CatalogEntry["licenseKind"], use?: CatalogEntry["use"],
];

function variants(family: string, publisher: string, defaultUse: CatalogEntry["use"], aliases: readonly string[], items: readonly Variant[]): CatalogEntry[] {
  return items.map(([tag, downloadGb, license, licenseKind, use = defaultUse]) => ({
    name: family + ":" + tag, publisher, aliases, downloadGb, license, licenseKind, use,
  }));
}

// Offline snapshot of local Ollama tags. Download sizes are the sum of published
// manifest layer sizes in decimal GB, rounded to three significant digits.
// License labels describe the packaged terms. Derivatives may carry upstream terms.
// Sources: https://ollama.com/library and https://registry.ollama.com/v2/library/
export const MODEL_CATALOG: readonly CatalogEntry[] = [
  ...variants("qwen3", "Alibaba Qwen", "Chat", ["通义千问3","千问3","Qwen 3","通义千问","阿里巴巴"], [
    ["0.6b", 0.523, "Apache-2.0", "permissive"],
    ["1.7b", 1.36, "Apache-2.0", "permissive"],
    ["4b", 2.5, "Apache-2.0", "permissive"],
    ["8b", 5.23, "Apache-2.0", "permissive"],
    ["14b", 9.28, "Apache-2.0", "permissive"],
    ["30b", 18.6, "Apache-2.0", "permissive"],
    ["32b", 20.2, "Apache-2.0", "permissive"],
    ["235b", 142, "Apache-2.0", "permissive"],
  ]),
  ...variants("qwen2.5", "Alibaba Qwen", "Chat", ["通义千问2.5","千问2.5","Qwen 2.5","通义千问","阿里巴巴"], [
    ["0.5b", 0.398, "Apache-2.0", "permissive"],
    ["1.5b", 0.986, "Apache-2.0", "permissive"],
    ["3b", 1.93, "Qwen Research License", "other"],
    ["7b", 4.68, "Apache-2.0", "permissive"],
    ["14b", 8.99, "Apache-2.0", "permissive"],
    ["32b", 19.9, "Apache-2.0", "permissive"],
    ["72b", 47.4, "Qwen Research License", "other"],
  ]),
  ...variants("qwen2.5-coder", "Alibaba Qwen", "Coding", ["通义千问2.5编程","千问代码","Qwen 2.5 Coder","通义千问","阿里巴巴"], [
    ["0.5b", 0.398, "Apache-2.0", "permissive"],
    ["1.5b", 0.986, "Apache-2.0", "permissive"],
    ["3b", 1.93, "Qwen Research License", "other"],
    ["7b", 4.68, "Apache-2.0", "permissive"],
    ["14b", 8.99, "Apache-2.0", "permissive"],
    ["32b", 19.9, "Apache-2.0", "permissive"],
  ]),
  ...variants("qwen3-coder", "Alibaba Qwen", "Coding", ["通义千问3编程","千问代码","Qwen 3 Coder","通义千问","阿里巴巴"], [
    ["30b", 18.6, "Apache-2.0", "permissive"],
    ["480b", 290, "Apache-2.0", "permissive"],
  ]),
  ...variants("qwen3-vl", "Alibaba Qwen", "Vision", ["通义千问3视觉","千问视觉","Qwen 3 VL","通义千问","阿里巴巴"], [
    ["2b", 1.89, "Apache-2.0", "permissive"],
    ["4b", 3.34, "Apache-2.0", "permissive"],
    ["8b", 6.19, "Apache-2.0", "permissive"],
    ["30b", 19.6, "Apache-2.0", "permissive"],
    ["32b", 20.9, "Apache-2.0", "permissive"],
    ["235b", 143, "Apache-2.0", "permissive"],
  ]),
  ...variants("qwen2.5vl", "Alibaba Qwen", "Vision", ["通义千问2.5视觉","千问视觉","Qwen 2.5 VL","通义千问","阿里巴巴"], [
    ["3b", 3.2, "Apache-2.0", "permissive"],
    ["7b", 5.97, "Apache-2.0", "permissive"],
    ["32b", 21.2, "Apache-2.0", "permissive"],
    ["72b", 48.7, "Apache-2.0", "permissive"],
  ]),
  ...variants("deepseek-r1", "DeepSeek", "Reasoning", ["深度求索","深度求索R1","DeepSeek R1","深度推理"], [
    ["1.5b", 1.12, "MIT", "permissive"],
    ["7b", 4.68, "MIT", "permissive"],
    ["8b", 5.23, "MIT", "permissive"],
    ["14b", 8.99, "MIT", "permissive"],
    ["32b", 19.9, "MIT", "permissive"],
    ["70b", 42.5, "MIT", "permissive"],
    ["671b", 404, "MIT", "permissive"],
  ]),
  ...variants("deepseek-coder", "DeepSeek", "Coding", ["深度求索","深度求索代码","DeepSeek Coder"], [
    ["1.3b", 0.776, "DeepSeek Model License", "open-weight"],
    ["6.7b", 3.83, "DeepSeek Model License", "open-weight"],
    ["33b", 18.8, "DeepSeek Model License", "open-weight"],
  ]),
  ...variants("deepseek-coder-v2", "DeepSeek", "Coding", ["深度求索","深度求索代码","DeepSeek Coder V2"], [
    ["16b", 8.91, "DeepSeek Model License + MIT", "open-weight"],
    ["236b", 133, "DeepSeek Model License + MIT", "open-weight"],
  ]),
  ...variants("llama3.1", "Meta", "Chat", ["Llama 3.1","羊驼3.1","Meta 羊驼"], [
    ["8b", 4.92, "Llama 3.1 Community License", "open-weight"],
    ["70b", 42.5, "Llama 3.1 Community License", "open-weight"],
    ["405b", 243, "Llama 3.1 Community License", "open-weight"],
  ]),
  ...variants("llama3.2", "Meta", "Chat", ["Llama 3.2","羊驼3.2","Meta 羊驼"], [
    ["1b", 1.32, "Llama 3.2 Community License", "open-weight"],
    ["3b", 2.02, "Llama 3.2 Community License", "open-weight"],
  ]),
  ...variants("llama3.2-vision", "Meta", "Vision", ["Llama 3.2 Vision","羊驼视觉","Meta 羊驼"], [
    ["11b", 7.82, "Llama 3.2 Community License", "open-weight"],
    ["90b", 54.6, "Llama 3.2 Community License", "open-weight"],
  ]),
  ...variants("llama3.3", "Meta", "Chat", ["Llama 3.3","羊驼3.3","Meta 羊驼"], [
    ["70b", 42.5, "Llama 3.3 Community License", "open-weight"],
  ]),
  ...variants("codellama", "Meta", "Coding", ["Code Llama","代码羊驼","Meta 羊驼"], [
    ["7b", 3.83, "Llama 2 Community License", "open-weight"],
    ["13b", 7.37, "Llama 2 Community License", "open-weight"],
  ]),
  ...variants("gemma3", "Google", "Vision", ["Gemma 3","谷歌Gemma3","谷歌"], [
    ["270m", 0.292, "Gemma Terms of Use", "open-weight"],
    ["1b", 0.806, "Gemma Terms of Use", "open-weight"],
    ["4b", 3.35, "Gemma Terms of Use", "open-weight"],
    ["12b", 8.16, "Gemma Terms of Use", "open-weight"],
    ["27b", 17.4, "Gemma Terms of Use", "open-weight"],
  ]),
  ...variants("gemma3n", "Google", "Vision", ["Gemma 3n","谷歌Gemma3n","谷歌"], [
    ["e2b", 7.84, "Gemma Terms of Use", "open-weight"],
    ["e4b", 9.77, "Gemma Terms of Use", "open-weight"],
  ]),
  ...variants("codegemma", "Google", "Coding", ["Code Gemma","谷歌代码模型","谷歌"], [
    ["2b", 1.55, "Gemma Terms of Use", "open-weight"],
    ["7b", 5.01, "Gemma Terms of Use", "open-weight"],
  ]),
  ...variants("embeddinggemma", "Google", "Embeddings", ["Embedding Gemma","谷歌嵌入","谷歌向量模型"], [
    ["300m", 0.622, "Gemma Terms of Use", "open-weight"],
  ]),
  ...variants("mistral", "Mistral AI", "Chat", ["Mistral 7B","米斯特拉尔","风模型"], [
    ["7b", 4.37, "Apache-2.0", "permissive"],
  ]),
  ...variants("mistral-nemo", "Mistral AI / NVIDIA", "Chat", ["Mistral NeMo","米斯特拉尔","英伟达"], [
    ["12b", 7.07, "Apache-2.0", "permissive"],
  ]),
  ...variants("mistral-small", "Mistral AI", "Chat", ["Mistral Small","米斯特拉尔小模型"], [
    ["22b", 12.6, "Mistral AI Research License", "other"],
    ["24b", 14.3, "Apache-2.0", "permissive"],
  ]),
  ...variants("mixtral", "Mistral AI", "Chat", ["Mixtral MoE","米斯特拉尔混合专家"], [
    ["8x7b", 26.4, "Apache-2.0", "permissive"],
    ["8x22b", 79.5, "Apache-2.0", "permissive"],
  ]),
  ...variants("codestral", "Mistral AI", "Coding", ["Codestral","米斯特拉尔代码"], [
    ["22b", 12.6, "Mistral AI Non-Production License", "other"],
  ]),
  ...variants("devstral", "Mistral AI / All Hands AI", "Coding", ["Devstral","米斯特拉尔编程代理"], [
    ["24b", 14.3, "Apache-2.0", "permissive"],
  ]),
  ...variants("ministral-3", "Mistral AI", "Vision", ["Ministral 3","米斯特拉尔小模型","米斯特拉尔视觉"], [
    ["3b", 2.95, "Apache-2.0", "permissive"],
    ["8b", 6.02, "Apache-2.0", "permissive"],
    ["14b", 9.08, "Apache-2.0", "permissive"],
  ]),
  ...variants("phi4", "Microsoft", "Reasoning", ["Phi-4","微软Phi4","微软"], [
    ["14b", 9.05, "MIT", "permissive"],
  ]),
  ...variants("phi4-mini", "Microsoft", "Chat", ["Phi-4 Mini","微软Phi4迷你","微软"], [
    ["3.8b", 2.49, "MIT", "permissive"],
  ]),
  ...variants("phi4-reasoning", "Microsoft", "Reasoning", ["Phi-4 Reasoning","微软Phi4推理","微软"], [
    ["14b", 11.1, "MIT", "permissive"],
    ["plus", 11.1, "MIT", "permissive"],
  ]),
  ...variants("phi3.5", "Microsoft", "Chat", ["Phi-3.5 Mini","微软Phi3.5","微软"], [
    ["3.8b", 2.18, "MIT", "permissive"],
  ]),
  ...variants("starcoder2", "BigCode", "Coding", ["StarCoder 2","星码","代码模型"], [
    ["3b", 1.71, "BigCode OpenRAIL-M", "open-weight"],
    ["7b", 4.04, "BigCode OpenRAIL-M", "open-weight"],
    ["15b", 9.07, "BigCode OpenRAIL-M", "open-weight"],
  ]),
  ...variants("nomic-embed-text", "Nomic AI", "Embeddings", ["Nomic Embed Text","诺米克文本嵌入","文本向量"], [
    ["latest", 0.274, "Apache-2.0", "permissive"],
  ]),
  ...variants("mxbai-embed-large", "Mixedbread AI", "Embeddings", ["Mixedbread Embed Large","文本嵌入","文本向量"], [
    ["latest", 0.67, "Apache-2.0", "permissive"],
  ]),
  ...variants("all-minilm", "Sentence Transformers", "Embeddings", ["all MiniLM","句子嵌入","句向量"], [
    ["latest", 0.046, "Apache-2.0", "permissive"],
    ["l12-v2", 0.0673, "Apache-2.0", "permissive"],
  ]),
  ...variants("bge-m3", "BAAI", "Embeddings", ["BGE M3","智源研究院","智源嵌入","多语种向量"], [
    ["567m", 1.16, "MIT", "permissive"],
  ]),
  ...variants("bge-large", "BAAI", "Embeddings", ["BGE Large","智源研究院","智源嵌入","文本向量"], [
    ["335m", 0.671, "MIT", "permissive"],
  ]),
  ...variants("snowflake-arctic-embed", "Snowflake", "Embeddings", ["Snowflake Arctic Embed","雪花嵌入","北极向量"], [
    ["xs", 0.0458, "Apache-2.0", "permissive"],
    ["s", 0.0672, "Apache-2.0", "permissive"],
    ["m", 0.219, "Apache-2.0", "permissive"],
    ["m-long", 0.274, "Apache-2.0", "permissive"],
    ["l", 0.669, "Apache-2.0", "permissive"],
  ]),
  ...variants("gpt-oss", "OpenAI", "Reasoning", ["GPT OSS","开放权重GPT","推理模型"], [
    ["20b", 13.8, "Apache-2.0", "permissive"],
    ["120b", 65.4, "Apache-2.0", "permissive"],
  ]),
  ...variants("granite3.3", "IBM", "Chat", ["Granite 3.3","IBM花岗岩","花岗岩模型"], [
    ["2b", 1.55, "Apache-2.0", "permissive"],
    ["8b", 4.94, "Apache-2.0", "permissive"],
  ]),
  ...variants("granite4", "IBM", "Chat", ["Granite 4","IBM花岗岩","花岗岩模型"], [
    ["350m-h", 0.366, "Apache-2.0", "permissive"],
    ["1b-h", 1.56, "Apache-2.0", "permissive"],
    ["3b-h", 1.94, "Apache-2.0", "permissive"],
    ["7b-a1b-h", 4.23, "Apache-2.0", "permissive"],
    ["32b-a9b-h", 19.5, "Apache-2.0", "permissive"],
  ]),
  ...variants("aya-expanse", "Cohere For AI", "Chat", ["Aya Expanse","科希尔","多语种对话"], [
    ["8b", 5.06, "CC BY-NC 4.0 + Acceptable Use Addendum", "other"],
    ["32b", 19.8, "CC BY-NC 4.0 + Acceptable Use Addendum", "other"],
  ]),
  ...variants("smollm2", "Hugging Face", "Chat", ["SmolLM 2","抱抱脸","小语言模型"], [
    ["135m", 0.271, "Apache-2.0", "permissive"],
    ["360m", 0.726, "Apache-2.0", "permissive"],
    ["1.7b", 1.82, "Apache-2.0", "permissive"],
  ]),
  ...variants("internlm2", "Shanghai AI Laboratory", "Chat", ["InternLM 2","书生浦语2","上海人工智能实验室"], [
    ["1.8b", 1.11, "Apache-2.0", "permissive"],
    ["7b", 4.45, "Apache-2.0", "permissive"],
    ["20b", 11.3, "Apache-2.0", "permissive"],
  ]),
  ...variants("minicpm-v", "OpenBMB", "Vision", ["MiniCPM-V","面壁小钢炮","面壁智能","视觉语言模型"], [
    ["8b", 5.47, "MiniCPM Model License", "open-weight"],
  ]),
  ...variants("rnj-1", "Essential AI", "Coding", ["RNJ-1","代码模型","数学推理"], [
    ["8b", 5.11, "Apache-2.0", "permissive"],
  ]),
  ...variants("olmo-3", "Allen Institute for AI", "Reasoning", ["Olmo 3","艾伦人工智能研究所","开放语言模型"], [
    ["7b-instruct", 4.47, "Apache-2.0", "permissive"],
    ["7b-think", 4.47, "Apache-2.0", "permissive", "Reasoning"],
    ["32b-think", 19.5, "Apache-2.0", "permissive", "Reasoning"],
  ]),
];
