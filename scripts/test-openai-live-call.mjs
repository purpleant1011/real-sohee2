import OpenAI from 'openai';

const textApiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY;
const imageApiKey = process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY;

async function testTextChat() {
  console.log('--- 1. Testing OpenAI Text Model (gpt-5.6-luna) ---');
  const openai = new OpenAI({ apiKey: textApiKey });
  const res = await openai.chat.completions.create({
    model: 'gpt-4o', // fallback if luna is internal
    messages: [
      { role: 'system', content: '너는 바이름 청라점의 AI 마케팅 직원 소희야. 눈썹 문신(자연눈썹) 관련 인스타그램 포스팅 문구를 작성해줘.' },
      { role: 'user', content: '소희야, 이번 주 자연눈썹 예약 슬롯 홍보 피드 글 써줘.' }
    ]
  });
  console.log('Response:\n', res.choices[0].message.content);
}

async function testImageGen() {
  console.log('\n--- 2. Testing OpenAI Image Model (gpt-image-2) ---');
  const openai = new OpenAI({ apiKey: imageApiKey });
  const prompt = 'A fresh baked Korean sweet pumpkin tart on a wooden plate, natural sunlight, appetizing, high-resolution aesthetic bakery photo';
  
  let imageRes;
  try {
    imageRes = await openai.images.generate({
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size: '1024x1024',
    });
  } catch (err) {
    console.warn('Image generation error:', err);
  }

  if (imageRes && imageRes.data && imageRes.data[0]) {
    const item = imageRes.data[0];
    const hasData = Boolean(item.url || item.b64_json);
    console.log('Image Generated Successfully! HasData:', hasData, item.url ? 'URL present' : 'b64_json present');
  }
}

async function main() {
  await testTextChat();
  await testImageGen();
}

main().catch(console.error);
