// ==================== NOTIFICATION PREFERENCES ====================
const IR_NOTIFICATION_DEFAULTS = {
  global_chat_mode:'every_message', direct_messages:true, challenges:true,
  results:true, tournaments:true, rankings:true, account_updates:true,
  sound_enabled:true, vibration_enabled:true, quiet_hours_enabled:false,
  quiet_start:'22:00', quiet_end:'07:00'
};
async function openNotificationSettings(){
  const modal=document.getElementById('irNotificationSettingsModal');
  if(!modal) return;
  modal.style.display='flex';
  await loadNotificationSettings();
}
function closeNotificationSettings(){
  const modal=document.getElementById('irNotificationSettingsModal');
  if(modal) modal.style.display='none';
}
async function loadNotificationSettings(){
  const status=document.getElementById('irNotifySettingsStatus');
  const {data:{user}}=await client.auth.getUser();
  if(!user){if(status)status.textContent='Please sign in to manage notification settings.';return;}
  const {data,error}=await client.from('notification_preferences').select('*').eq('user_id',user.id).maybeSingle();
  if(error){if(status)status.textContent='Run the notification SQL setup first: '+error.message;return;}
  const v={...IR_NOTIFICATION_DEFAULTS,...(data||{})};
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.type==='checkbox'?el.checked=!!value:el.value=value??'';};
  set('irPrefGlobalChat',v.global_chat_mode);set('irPrefDirectMessages',v.direct_messages);set('irPrefChallenges',v.challenges);set('irPrefResults',v.results);set('irPrefTournaments',v.tournaments);set('irPrefRankings',v.rankings);set('irPrefAccount',v.account_updates);set('irPrefSound',v.sound_enabled);set('irPrefVibration',v.vibration_enabled);set('irPrefQuiet',v.quiet_hours_enabled);set('irPrefQuietStart',v.quiet_start);set('irPrefQuietEnd',v.quiet_end);
  if(status)status.textContent=data?'Your saved settings are loaded.':'Default settings are ready. Save to keep them on your account.';
}
async function saveNotificationSettings(){
  const status=document.getElementById('irNotifySettingsStatus');
  const {data:{user}}=await client.auth.getUser();
  if(!user){if(status)status.textContent='Please sign in first.';return;}
  const val=id=>document.getElementById(id);
  const payload={user_id:user.id,global_chat_mode:val('irPrefGlobalChat').value,direct_messages:val('irPrefDirectMessages').checked,challenges:val('irPrefChallenges').checked,results:val('irPrefResults').checked,tournaments:val('irPrefTournaments').checked,rankings:val('irPrefRankings').checked,account_updates:val('irPrefAccount').checked,sound_enabled:val('irPrefSound').checked,vibration_enabled:val('irPrefVibration').checked,quiet_hours_enabled:val('irPrefQuiet').checked,quiet_start:val('irPrefQuietStart').value||'22:00',quiet_end:val('irPrefQuietEnd').value||'07:00',timezone_name:Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata',updated_at:new Date().toISOString()};
  const {error}=await client.from('notification_preferences').upsert(payload,{onConflict:'user_id'});
  if(error){if(status)status.textContent='Could not save: '+error.message;return;}
  if(status)status.textContent='✅ Notification preferences saved to your account.';
}
