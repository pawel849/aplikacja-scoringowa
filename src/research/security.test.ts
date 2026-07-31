import { describe, expect, it } from "vitest";
import { isPublicIp, readLimitedText } from "./security";

describe("ochrona pobierania publicznych stron", () => {
  it.each(["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1", "::ffff:127.0.0.1"])("odrzuca adres %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });

  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("uznaje publiczny adres %s", (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it("przerywa odczyt strumienia po przekroczeniu limitu", async () => {
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("12345"));
        controller.enqueue(new TextEncoder().encode("67890"));
        controller.close();
      }
    }));
    await expect(readLimitedText(response, 8)).rejects.toThrow("przekracza limit");
  });

  it("odrzuca odpowiedź z zadeklarowaną nadmierną długością", async () => {
    const response = new Response("mała", { headers: { "content-length": "1000" } });
    await expect(readLimitedText(response, 100)).rejects.toThrow("przekracza limit");
  });
});
