const timePicker=document.createElement('div');
timePicker.className='time-picker-popover';timePicker.hidden=true;
timePicker.setAttribute('role','dialog');timePicker.setAttribute('aria-label','选择时间');
timePicker.innerHTML=`<div class="time-picker-heading">选择时间</div>
  <div class="time-picker-month"><button type="button" data-picker-month="-1" aria-label="上个月">‹</button><strong class="time-picker-month-label"></strong><button type="button" data-picker-month="1" aria-label="下个月">›</button></div>
  <div class="time-picker-weekdays"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
  <div class="time-picker-days"></div>
  <div class="time-picker-time"><span>时间</span><div><select class="time-picker-hour" aria-label="小时"></select><b>:</b><select class="time-picker-minute" aria-label="分钟"></select></div></div>
  <div class="time-picker-footer"><button type="button" class="time-picker-clear">↶ 清空</button><span></span><button type="button" class="time-picker-now">当前时间</button><button type="button" class="time-picker-confirm">✓ 确定</button></div>`;
document.body.append(timePicker);
let timePickerTarget=null,timePickerDraftDate='',timePickerYear=0,timePickerMonth=0;
const pickerHour=timePicker.querySelector('.time-picker-hour');
const pickerMinute=timePicker.querySelector('.time-picker-minute');
for(let hour=0;hour<24;hour++)pickerHour.append(new Option(`${String(hour).padStart(2,'0')} 时`,String(hour).padStart(2,'0')));
for(let minute=0;minute<60;minute++)pickerMinute.append(new Option(`${String(minute).padStart(2,'0')} 分`,String(minute).padStart(2,'0')));
function beijingNowMinute() { return new Date(Date.now()+8*3600000).toISOString().slice(0,16); }
function refreshTimeButton(input) {
  const button=input._timeButton;if(!button)return;
  const value=input.value;
  button.querySelector('.time-picker-value').textContent=value
    ? `${Number(value.slice(0,4))}年${Number(value.slice(5,7))}月${Number(value.slice(8,10))}日 ${value.slice(11,16)}`
    : (input.id.toLowerCase().endsWith('start')?'选择开始时间':'选择结束时间');
  button.classList.toggle('is-empty',!value);
}
function closeTimePicker() {
  if(timePickerTarget)timePickerTarget.button.setAttribute('aria-expanded','false');
  timePickerTarget=null;timePicker.hidden=true;
}
function placeTimePicker() {
  if(!timePickerTarget||timePicker.hidden)return;
  const rect=timePickerTarget.button.getBoundingClientRect();
  const width=timePicker.offsetWidth,height=timePicker.offsetHeight;
  timePicker.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-width-12))}px`;
  timePicker.style.top=`${rect.bottom+8+height>innerHeight-12&&rect.top-height-8>=12
    ? rect.top-height-8 : Math.max(12,Math.min(rect.bottom+8,innerHeight-height-12))}px`;
}
function renderTimePickerDays() {
  const monthNames=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  timePicker.querySelector('.time-picker-month-label').textContent=`${monthNames[timePickerMonth]} ${timePickerYear}`;
  const first=(new Date(Date.UTC(timePickerYear,timePickerMonth,1)).getUTCDay()+6)%7;
  const days=new Date(Date.UTC(timePickerYear,timePickerMonth+1,0)).getUTCDate();
  const total=Math.max(35,Math.ceil((first+days)/7)*7);
  const today=beijingNowMinute().slice(0,10),grid=timePicker.querySelector('.time-picker-days');
  grid.replaceChildren();
  for(let index=0;index<total;index++){
    const date=new Date(Date.UTC(timePickerYear,timePickerMonth,1-first+index));
    const value=date.toISOString().slice(0,10),button=document.createElement('button');
    button.type='button';button.textContent=String(date.getUTCDate());button.setAttribute('aria-label',value);
    if(date.getUTCMonth()!==timePickerMonth)button.classList.add('is-adjacent');
    if(value===today)button.classList.add('is-today');
    if(value===timePickerDraftDate){button.classList.add('is-selected');button.setAttribute('aria-selected','true');}
    button.onclick=()=>{
      timePickerDraftDate=value;timePickerYear=date.getUTCFullYear();timePickerMonth=date.getUTCMonth();
      renderTimePickerDays();placeTimePicker();
    };
    grid.append(button);
  }
}
function openTimePicker(input,button) {
  if(timePickerTarget?.input===input){closeTimePicker();return;}
  closeTimePicker();
  const root=input.closest(':fullscreen,.map-window-expanded')||input.closest('dialog')||document.body;root.append(timePicker);
  timePickerTarget={input,button};button.setAttribute('aria-expanded','true');
  const now=beijingNowMinute();
  const value=input.value||(input.id.toLowerCase().endsWith('start')?`${now.slice(0,10)}T00:00`:now);
  timePickerDraftDate=value.slice(0,10);
  timePickerYear=Number(value.slice(0,4));timePickerMonth=Number(value.slice(5,7))-1;
  pickerHour.value=value.slice(11,13);pickerMinute.value=value.slice(14,16);
  renderTimePickerDays();timePicker.hidden=false;placeTimePicker();
}
function initTimeButton(id,title) {
  const input=document.getElementById(id),button=document.createElement('button');
  input.hidden=true;button.type='button';button.className='time-picker-trigger';
  button.setAttribute('aria-label',title);button.setAttribute('aria-expanded','false');
  button.innerHTML='<span class="time-picker-value"></span>';
  input.before(button);input._timeButton=button;refreshTimeButton(input);
  button.onclick=()=>openTimePicker(input,button);
}
document.querySelectorAll('input[type="datetime-local"]').forEach(input=>initTimeButton(input.id,input.closest('label').firstChild.textContent.trim()));

timePicker.querySelectorAll('[data-picker-month]').forEach(button=>button.onclick=()=>{
  const date=new Date(Date.UTC(timePickerYear,timePickerMonth+Number(button.dataset.pickerMonth),1));
  timePickerYear=date.getUTCFullYear();timePickerMonth=date.getUTCMonth();renderTimePickerDays();placeTimePicker();
});
timePicker.querySelector('.time-picker-now').onclick=()=>{
  const now=beijingNowMinute();timePickerDraftDate=now.slice(0,10);
  timePickerYear=Number(now.slice(0,4));timePickerMonth=Number(now.slice(5,7))-1;
  pickerHour.value=now.slice(11,13);pickerMinute.value=now.slice(14,16);
  renderTimePickerDays();placeTimePicker();
};
timePicker.querySelector('.time-picker-clear').onclick=()=>{
  if(!timePickerTarget)return;
  const input=timePickerTarget.input;input.value='';refreshTimeButton(input);
  closeTimePicker();input.dispatchEvent(new Event('change',{bubbles:true}));if(input.closest('form')?.id==='historyFilter')document.getElementById('historyFilter').requestSubmit();
};
timePicker.querySelector('.time-picker-confirm').onclick=()=>{
  if(!timePickerTarget)return;
  const input=timePickerTarget.input;
  input.value=`${timePickerDraftDate}T${pickerHour.value}:${pickerMinute.value}`;
  refreshTimeButton(input);closeTimePicker();input.dispatchEvent(new Event('change',{bubbles:true}));if(input.closest('form')?.id==='historyFilter')document.getElementById('historyFilter').requestSubmit();
};
document.addEventListener('pointerdown',event=>{
  if(timePickerTarget&&!timePicker.contains(event.target)&&!timePickerTarget.button.contains(event.target))closeTimePicker();
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&timePickerTarget){event.preventDefault();event.stopImmediatePropagation();closeTimePicker();}
},true);
window.addEventListener('resize',placeTimePicker);
document.addEventListener('scroll',placeTimePicker,true);
