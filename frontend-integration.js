/*
Подключение Render-конвертера к существующему генератору.

1. Замени URL ниже адресом Render после развёртывания.
2. После завершения browser MediaRecorder передай Blob в convertToMp4().
3. Функция скачает настоящий MP4 H.264/AAC.
*/

const MP4_API_URL = "https://YOUR-RENDER-SERVICE.onrender.com";

async function convertToMp4(webmBlob, birthDate, onProgress = () => {}) {
  const safeDate = birthDate.split("-").reverse().join("-");
  const formData = new FormData();

  formData.append(
    "video",
    webmBlob,
    `Soul_Mandala_${safeDate}.webm`
  );
  formData.append(
    "filename",
    `Soul_Mandala_${safeDate}_120s`
  );

  onProgress("Конвертация в MP4…");

  const response = await fetch(`${MP4_API_URL}/convert`, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    let message = "Сервер не смог создать MP4.";
    try {
      const data = await response.json();
      message = data.error || message;
    } catch (_) {}
    throw new Error(message);
  }

  const mp4Blob = await response.blob();
  const url = URL.createObjectURL(mp4Blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `Soul_Mandala_${safeDate}_120s.mp4`;
  document.body.appendChild(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  onProgress("MP4 сохранён");
}
