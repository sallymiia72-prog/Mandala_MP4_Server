
const MANDALA_RENDER_URL = "https://YOUR-SERVICE.onrender.com";

async function downloadServerMp4(birthDate, button, statusNode){
  if(!birthDate){
    alert("Сначала введи дату рождения.");
    return;
  }

  const oldText=button.textContent;
  button.disabled=true;
  button.textContent="Создаётся MP4…";
  statusNode.textContent="Сервер создаёт видео. Не закрывай страницу.";

  try{
    const response=await fetch(`${MANDALA_RENDER_URL}/render`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({birthDate,duration:60})
    });

    if(!response.ok){
      const data=await response.json().catch(()=>({}));
      throw new Error(data.error||"Не удалось создать MP4.");
    }

    const blob=await response.blob();
    const url=URL.createObjectURL(blob);
    const safeDate=birthDate.split("-").reverse().join("-");
    const link=document.createElement("a");
    link.href=url;
    link.download=`Soul_Mandala_${safeDate}_60s.mp4`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);

    statusNode.textContent="MP4 сохранён";
  }catch(error){
    console.error(error);
    alert(error.message);
    statusNode.textContent="Ошибка создания MP4";
  }finally{
    button.disabled=false;
    button.textContent=oldText;
  }
}
