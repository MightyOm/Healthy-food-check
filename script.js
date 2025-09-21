// CONFIG: where your Teachable Machine export sits (folder with model.json & metadata.json)
const MODEL_PATH = './model/';

let model, maxPredictions, webcam;
const labelListEl = document.getElementById('label-list');
const topResultEl = document.getElementById('top-result');
const nutritionCard = document.getElementById('nutrition-card');
const usdaBtn = document.getElementById('usda-lookup');

const CONF_THRESHOLD_EL = document.getElementById('confidence-threshold');
let CONF_THRESHOLD = parseFloat(CONF_THRESHOLD_EL.value);

// LOCAL demo nutrition DB (easy to edit)
const localNutritionDB = {
  'Apple': { calories: 95, protein: 0.5, fat: 0.3, carbs: 25 },
  'Banana': { calories: 105, protein: 1.3, fat: 0.3, carbs: 27 },
  'Pizza': { calories: 285, protein: 12, fat: 10, carbs: 36 },
  'Salad': { calories: 33, protein: 2, fat: 0.4, carbs: 6 },
  'Orange': { calories: 62, protein: 1.2, fat: 0.2, carbs: 15 }
};

// ---- UI wiring
document.getElementById('start-webcam').addEventListener('click', startWebcam);
document.getElementById('stop-webcam').addEventListener('click', stopWebcam);
document.getElementById('upload').addEventListener('change', handleUpload);
CONF_THRESHOLD_EL.addEventListener('change', ()=>{ CONF_THRESHOLD = parseFloat(CONF_THRESHOLD_EL.value); });

// optional USDA lookup (calls serverless proxy at /.netlify/functions/usda?q=...)
usdaBtn.addEventListener('click', async ()=>{
  const label = topResultEl.dataset.label;
  if(!label) return alert('No top label to lookup');
  try{
    nutritionCard.innerHTML = 'Searching USDA...';
    const res = await fetch(`/.netlify/functions/usda?q=${encodeURIComponent(label)}`);
    if(!res.ok) throw new Error('Server error');
    const data = await res.json();
    // This expects the proxy to return a parsed nutrient object (adjust based on your function)
    if(data && data.nutrients) {
      showNutrition({label, source:'USDA', ...data.nutrients});
    } else {
      nutritionCard.innerHTML = 'No USDA data found';
    }
  } catch(e){
    nutritionCard.innerHTML = 'USDA lookup failed (see console)';
    console.error(e);
  }
});

// ---- load model on start
async function loadModel(){
  try{
    const modelURL = MODEL_PATH + 'model.json';
    const metadataURL = MODEL_PATH + 'metadata.json';
    model = await tmImage.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses();
    topResultEl.textContent = 'Model loaded — use webcam or upload an image';
    console.log('Model loaded, classes:', maxPredictions);
  } catch(err){
    console.error('Model load failed — check model path and run a local server:', err);
    topResultEl.textContent = 'Error loading model (see console).';
  }
}
loadModel();

// ---- webcam functions (uses tmImage.Webcam helper)
async function startWebcam(){
  if(!model){ alert('Model not loaded yet'); return; }
  // create webcam (width, height, flip horizontally)
  webcam = new tmImage.Webcam(320, 240, true);
  await webcam.setup();
  await webcam.play();
  // append canvas into DOM
  const container = document.getElementById('webcam-container');
  container.innerHTML = ''; // clear placeholder
  container.appendChild(webcam.canvas);
  // update UI
  document.getElementById('start-webcam').disabled = true;
  document.getElementById('stop-webcam').disabled = false;
  // start loop
  window.requestAnimationFrame(loop);
}

function stopWebcam(){
  if(webcam){ webcam.stop(); webcam = null; }
  const container = document.getElementById('webcam-container');
  container.innerHTML = '<div class="placeholder">Webcam / image preview</div>';
  document.getElementById('start-webcam').disabled = false;
  document.getElementById('stop-webcam').disabled = true;
}

// runs each frame when webcam active
async function loop(){
  if(!webcam) return;
  webcam.update(); // update the internal canvas
  await predict(webcam.canvas);
  window.requestAnimationFrame(loop);
}

// handle file upload
function handleUpload(e){
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const img = new Image();
  img.onload = async () => {
    const container = document.getElementById('webcam-container');
    container.innerHTML = '';
    img.style.maxWidth = '100%';
    container.appendChild(img);
    await predict(img);
  };
  img.src = URL.createObjectURL(f);
}

// main predict routine (input is <img> or <canvas>)
async function predict(inputEl){
  if(!model) return;
  try{
    const preds = await model.predict(inputEl, false);
    // sort by probability descending
    preds.sort((a,b)=>b.probability - a.probability);

    // show top result
    const top = preds[0];
    if(top && top.probability >= CONF_THRESHOLD){
      topResultEl.textContent = `${top.className} — ${(top.probability*100).toFixed(1)}%`;
      topResultEl.dataset.label = top.className;
      showTopList(preds, 5);
      showNutritionFor(top.className);
    } else {
      topResultEl.textContent = 'Not confident enough — try a better photo or lower threshold';
      topResultEl.dataset.label = '';
      labelListEl.innerHTML = '';
      nutritionCard.innerHTML = 'No nutrition data';
      usdaBtn.style.display = 'none';
    }
  } catch(err){
    console.error('Prediction error:', err);
  }
}

// show list of top predictions with bars
function showTopList(preds, n=5){
  labelListEl.innerHTML = '';
  for(let i=0;i<Math.min(n, preds.length);i++){
    const p = preds[i];
    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `<strong>${p.className}</strong> — ${(p.probability*100).toFixed(1)}% 
        <div class="bar"><div class="fill" style="width:${(p.probability*100).toFixed(1)}%"></div></div>`;
    labelListEl.appendChild(div);
  }
}

// show nutrition from local DB (demo)
function showNutritionFor(label){
  // case-insensitive match
  const key = Object.keys(localNutritionDB).find(k => k.toLowerCase() === label.toLowerCase());
  if(key){
    const n = localNutritionDB[key];
    showNutrition({label:key, source:'local', ...n});
    usdaBtn.style.display = 'inline-block';
  } else {
    nutritionCard.innerHTML = `No demo data for "<strong>${label}</strong>". Try "Apple" or "Banana".`;
    usdaBtn.style.display = 'inline-block'; // let user try USDA lookup if they set it up
  }
}

function showNutrition(obj){
  nutritionCard.innerHTML = `
    <strong>${obj.label}</strong> <span class="muted">(${obj.source})</span><br/>
    Calories: ${obj.calories ?? '—'} kcal<br/>
    Protein: ${obj.protein ?? '—'} g<br/>
    Fat: ${obj.fat ?? '—'} g<br/>
    Carbs: ${obj.carbs ?? '—'} g
  `;
}
