
import { GoogleGenAI, Type } from "@google/genai";

export interface BoundingBox {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
  label: string;
}

/**
 * Uses Gemini 3 Vision to detect PII in a frame.
 * Returns normalized coordinates [0-1000].
 */
export const detectPII = async (dataUrl: string): Promise<BoundingBox[]> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Data = dataUrl.split(',')[1];

  const prompt = `
    Analyze this application screenshot and identify all Personal Identifying Information (PII). 
    This is critical for privacy compliance. Detect and return bounding boxes for:
    - Faces
    - Identity Documents (IDs, Passports, Licenses)
    - Financial Info (IBAN, Credit Card numbers, Bank Account numbers)
    - Full Names (in both Arabic and English scripts)
    - Residential Addresses
    - Dates of Birth (DOB)
    - Phone numbers or Email addresses
    
    Return the result as a JSON array of objects, each with ymin, xmin, ymax, xmax (scale 0-1000) and a label.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          { inlineData: { mimeType: "image/png", data: base64Data } },
          { text: prompt }
        ]
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              ymin: { type: Type.NUMBER },
              xmin: { type: Type.NUMBER },
              ymax: { type: Type.NUMBER },
              xmax: { type: Type.NUMBER },
              label: { type: Type.STRING }
            },
            required: ["ymin", "xmin", "ymax", "xmax", "label"]
          }
        }
      }
    });

    const jsonStr = response.text;
    return JSON.parse(jsonStr) as BoundingBox[];
  } catch (error) {
    console.error("Gemini PII Detection Error:", error);
    return [];
  }
};
