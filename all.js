// ============================================================
// INTER RIVALRY - COMPLETE JAVASCRIPT
// ============================================================

// ===== SUPABASE CONFIG =====
const SUPABASE_URL = "https://qfkxvflyzucvkeyucbzn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Se88Rw_onDUYfnMHxogs2g_q6WGY_3T";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ===== GLOBALS =====
let selectedCollegeId = null, selectedProfileId = null;
let allRivalsCache = [], rivalInterestMap = new Map(), rivalAcademicMap = new Map();
let interestSkillCache = [], currentInterestIds = new Set();
let selectedChallengeMode = "solo";
let leaderboardData = [], currentLeaderboardFilter = 'overall', currentUserRank = null;
let allStudentsData = [], allRivalsData = [], rivalsVisible = false, currentUserRole = '', currentUserProfile = null;
let allGames = [], currentGameFilter = 'all';
let currentQuizSession = null, currentQuestions = [], currentQuestionIndex = 0, playerScore = 0, opponentScore = 0, selectedCategory = 'all', quizTimer = null, timeLeft = 30;
let currentGradeTab = 'subjects', mySubjects = [];
let rivalsLoading = false, rivalsLoaded = false;

// ===== UTILITY =====
function escapeHTML(v){ if(v===null||v===undefined) return ""; return String(v).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function formatDate(v){ if(!v) return "-"; const d=new Date(v); if(isNaN(d.getTime())) return "-"; return d.toLocaleString(); }

// ===== AUTH =====
function showMessage(m){ document.getElementById("authMessage").textContent = m; }
function showSignup(){ document.getElementById("loginForm").classList.add("hidden"); document.getElementById("signupForm").classList.remove("hidden"); showMessage(""); }
function showLogin(){ document.getElementById("signupForm").classList.add("hidden"); document.getElementById("loginForm").classList.remove("hidden"); showMessage(""); }
function showAuth(){ hideAll(); document.getElementById("authPage").classList.remove("hidden"); }

async function signup(){
    const name=document.getElementById("signupName").value.trim();
    const email=document.getElementById("signupEmail").value.trim();
    const password=document.getElementById("signupPassword").value;
    if(!name||!email||!password){ showMessage("Please fill in all fields."); return; }
    if(password.length<6){ showMessage("Password must be at least 6 characters."); return; }
    showMessage("Creating account...");
    const {data,error}=await client.auth.signUp({
        email,password,
        options:{emailRedirectTo:window.location.origin+window.location.pathname,data:{full_name:name}}
    });
    if(error){ showMessage(error.message); return; }
    if(!data.session){ showMessage("✅ Account created! Check your email to confirm."); return; }
    const {error:profileError}=await client.from("profiles").insert({
        id:data.user.id,full_name:name,role:'student',inter_rivalry_id:null,college_joined:false
    });
    if(profileError){ console.error(profileError); showMessage("Account created but profile setup failed."); return; }
    showMessage("✅ Account created! Please join a college to get your INTER RIVALRY ID.");
    await loadUser();
}

async function login(){
    const email=document.getElementById("loginEmail").value.trim();
    const password=document.getElementById("loginPassword").value;
    if(!email||!password){ showMessage("Please enter your email and password."); return; }
    showMessage("Logging in...");
    const {error}=await client.auth.signInWithPassword({email,password});
    if(error){ showMessage(error.message); return; }
    await loadUser();
}

async function forgotPassword(){
    const email=document.getElementById("loginEmail").value.trim();
    if(!email){ showMessage("Enter your email first."); return; }
    showMessage("Sending reset email...");
    const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:window.location.origin+window.location.pathname});
    if(error){ showMessage(error.message); return; }
    showMessage("✅ Password reset email sent!");
}

async function resendConfirmationEmail(){
    const email=document.getElementById("loginEmail").value.trim();
    if(!email){ showMessage("Enter your email first."); return; }
    showMessage("Sending confirmation email...");
    const {error}=await client.auth.resend({type:"signup",email,options:{emailRedirectTo:window.location.origin+window.location.pathname}});
    if(error){ showMessage(error.message); return; }
    showMessage("✅ Confirmation email sent!");
}

async function logout(){
    await client.auth.signOut();
    selectedCollegeId=null; selectedProfileId=null;
    showAuth();
}

// ===== NAVIGATION =====
function hideAll(){
    document.querySelectorAll("section").forEach(s=>s.classList.add("hidden"));
    document.getElementById("loadingScreen").classList.add("hidden");
    ["leaderboardPage","tournamentsPage","categoryRankingsPage","toolboxPage","quizBattlePage","gradebookPage"].forEach(id=>{
        const el=document.getElementById(id); if(el) el.classList.add("hidden");
    });
}

function backToStudentDashboard(){
    document.getElementById("createTeamPage").classList.add("hidden");
    document.getElementById("teamDetailsPage").classList.add("hidden");
    document.getElementById("studentDashboard").classList.remove("hidden");
    if(currentUserProfile&&currentUserProfile.college_joined){
        loadMyTeams(); loadTeamInvites(); loadMyInterestSummary(); loadMyQuickStats(); loadNotifications();
    }
    loadStudentDashboardFromCurrentUser();
}
function backToProfile(){ document.getElementById("profilePage").classList.remove("hidden"); document.getElementById("challengePage").classList.add("hidden"); }
function backToAdmin(){ selectedCollegeId=null; loadAdminDashboard(); }
function backToManagement(){ document.getElementById("collegeManagement").classList.remove("hidden"); }
function showOnlyStudent(){ hideAll(); document.getElementById("studentDashboard").classList.remove("hidden"); }
function showOnlyProfile(){ hideAll(); document.getElementById("profilePage").classList.remove("hidden"); }
function showOnlyChallenge(){ hideAll(); document.getElementById("challengePage").classList.remove("hidden"); }
function showOnlyMyChallenges(){ hideAll(); document.getElementById("myChallengesPage").classList.remove("hidden"); loadMyChallenges(); }
function showOnlyAdmin(){ hideAll(); document.getElementById("adminDashboard").classList.remove("hidden"); }
function showOnlyCollegeManagement(){ hideAll(); document.getElementById("collegeManagement").classList.remove("hidden"); }
function showOnlyAdmins(){ hideAll(); document.getElementById("adminsPage").classList.remove("hidden"); }
function showOnlyStudents(){ hideAll(); document.getElementById("studentsPage").classList.remove("hidden"); }
function showOnlyRequests(){ hideAll(); document.getElementById("requestsPage").classList.remove("hidden"); }
function showOnlyInterests(){ hideAll(); document.getElementById("interestsPage").classList.remove("hidden"); loadInterestsEditor(); }
function showOnlyResults(){ hideAll(); document.getElementById("resultsPage").classList.remove("hidden"); loadResults(); }
function showCreateTeam(){ document.getElementById("createTeamPage").classList.remove("hidden"); document.getElementById("studentDashboard").classList.add("hidden"); }
function showLeaderboard(){ hideAll(); document.getElementById("leaderboardPage").classList.remove("hidden"); loadLeaderboard('overall'); }
function showCategoryRankings(){ hideAll(); document.getElementById("categoryRankingsPage").classList.remove("hidden"); loadCategoryRankings('all'); }
function showTournaments(){ hideAll(); document.getElementById("tournamentsPage").classList.remove("hidden"); loadTournaments('all'); }
function showToolbox(){ hideAll(); document.getElementById("toolboxPage").classList.remove("hidden"); loadGames(); }
function showQuizBattle(){ hideAll(); document.getElementById("quizBattlePage").classList.remove("hidden"); loadQuizCategories('all'); loadQuizHistory(); }
function showGradebook(){ hideAll(); document.getElementById("gradebookPage").classList.remove("hidden"); switchGradeTab('subjects'); }

// ===== LOAD USER =====
async function loadUser(){
    const {data:{user}}=await client.auth.getUser();
    if(!user){ showAuth(); return; }
    const {data:profile,error}=await client.from("profiles").select("*").eq("id",user.id).single();
    if(error||!profile){ console.error(error); showAuth(); return; }
    currentUserRole=profile.role||''; currentUserProfile=profile;
    if(profile.role==="super_admin"){ await loadAdminDashboard(); return; }
    if(profile.role==="college_admin"){ await loadCollegeAdminDashboard(user,profile); return; }
    await loadStudentDashboard(user,profile);
}

async function loadStudentDashboardFromCurrentUser(){
    const {data:{user}}=await client.auth.getUser();
    if(!user){ showAuth(); return; }
    const {data:profile}=await client.from("profiles").select("*").eq("id",user.id).single();
    if(profile){ currentUserProfile=profile; await loadStudentDashboard(user,profile); }
}

// ===== STUDENT DASHBOARD =====
async function loadStudentDashboard(user,profile){
    document.getElementById("userName").textContent=profile.full_name||"Student";
    const {data:membership}=await client.from("college_memberships").select("college_id,department,course,year_of_study,specialization,colleges(college_name,college_code,city,state)").eq("user_id",user.id).eq("is_active",true).maybeSingle();
    const collegeStatus=document.getElementById("collegeStatus");
    const hasJoinedCollege=membership&&membership.colleges;
    if(!hasJoinedCollege){
        document.getElementById("studentCollegeSection").style.display="block";
        await loadStudentColleges();
        document.getElementById("myQuickStats").innerHTML="";
        document.getElementById("interestsSection").style.display="none";
        document.getElementById("teamsSection").style.display="none";
        document.getElementById("teamInvitesSection").style.display="none";
        document.getElementById("battlefieldSection").style.display="none";
        document.getElementById("rivalsSectionFull").style.display="none";
        document.getElementById("actionButtons").style.display="none";
        document.getElementById("bottomButtons").style.display="none";
        document.getElementById("rivalryId").textContent="Not assigned";
        document.getElementById("rivalryId").style.color="#ff6b6b";
        collegeStatus.textContent="❗ College: Not joined yet - Please join below!";
        collegeStatus.style.color="#fdcb6e";
        document.getElementById("welcomeSubText").textContent="⚠️ Join a college to unlock all features!";
        document.getElementById("emptyRankMessage").innerHTML=`<div style="color:#fdcb6e;font-size:18px;font-weight:700;margin-bottom:10px;">🏛️ College Required</div><p style="color:#888;">You must join a college to access all features.</p><p style="color:#666;font-size:14px;margin-top:10px;">Select a college above to get started!</p>`;
        showOnlyStudent(); return;
    }
    if(!profile.inter_rivalry_id){
        const collegeCode=membership.colleges?.college_code||'XXXX';
        const randomNum=String(Math.floor(1000+Math.random()*9000));
        const newRivalryId=`IR-${collegeCode}-${randomNum}`;
        await client.from("profiles").update({inter_rivalry_id:newRivalryId,college_joined:true}).eq("id",user.id);
        profile.inter_rivalry_id=newRivalryId; profile.college_joined=true; currentUserProfile=profile;
        showMessage(`🎉 Welcome! Your INTER RIVALRY ID: ${newRivalyId}`);
    }
    document.getElementById("rivalryId").textContent=profile.inter_rivalry_id||"Not assigned";
    document.getElementById("rivalryId").style.color="#00d2ff";
    collegeStatus.textContent="✅ College: "+membership.colleges.college_name+" ("+membership.colleges.college_code+")";
    collegeStatus.style.color="#00b894";
    document.getElementById("studentCollegeSection").style.display="none";
    document.getElementById("welcomeSubText").textContent="Your rivalry journey starts here.";
    document.getElementById("emptyRankMessage").innerHTML="No skill ranks yet.<br>Participate in a skill to begin your ranking journey.";
    document.getElementById("interestsSection").style.display="block";
    document.getElementById("teamsSection").style.display="block";
    document.getElementById("teamInvitesSection").style.display="block";
    document.getElementById("battlefieldSection").style.display="block";
    document.getElementById("rivalsSectionFull").style.display="block";
    document.getElementById("actionButtons").style.display="flex";
    document.getElementById("bottomButtons").style.display="grid";
    await loadMyTeams(); await loadTeamInvites(); await loadMyInterestSummary(); await loadMyQuickStats(); await loadNotifications();
    showOnlyStudent();
}

// ===== STUDENT COLLEGES =====
async function loadStudentColleges(){
    const {data,error}=await client.from("colleges").select("id,college_name,college_code,city,state").order("college_name",{ascending:true});
    const list=document.getElementById("collegeList");
    list.innerHTML="";
    if(error||!data||data.length===0){ list.innerHTML="<div class='empty-box'>No colleges available.</div>"; return; }
    data.forEach(college=>{
        const card=document.createElement("div");
        card.className="college-card";
        card.style.borderColor="#fdcb6e";
        card.style.borderWidth="2px";
        card.innerHTML=`<h3 style="color:#fdcb6e;">🏛️ ${escapeHTML(college.college_name)}</h3><div class="college-code">${escapeHTML(college.college_code)}</div><div class="college-location">${escapeHTML(college.city||"")}${college.state?", "+escapeHTML(college.state):""}</div><button class="btn-3d-white-glow-gold" onclick="showJoinForm('${college.id}')" style="margin-top:10px;padding:12px;">🎯 JOIN COLLEGE TO GET ID</button>`;
        list.appendChild(card);
    });
}

async function showJoinForm(collegeId){
    const overlay=document.createElement('div');
    overlay.style.cssText=`position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;padding:20px;backdrop-filter:blur(10px);`;
    const modal=document.createElement('div');
    modal.style.cssText=`background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:40px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;`;
    let selectedCourse=null, selectedYear=null, selectedSpecialization=null;
    modal.innerHTML=`
        <h2 style="color:white;margin-bottom:10px;text-align:center;">🎓 Join College</h2>
        <p style="color:#888;text-align:center;margin-bottom:25px;">Select your details below to get your INTER RIVALRY ID</p>
        <div style="margin-bottom:20px;"><label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">📚 Select Course</label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            <button class="course-btn btn-3d-sm-white-glow" data-value="BCA">BCA</button>
            <button class="course-btn btn-3d-sm-white-glow" data-value="BBA">BBA</button>
            <button class="course-btn btn-3d-sm-white-glow" data-value="B.COM">B.Com</button>
        </div>
        <div id="selectedCourseDisplay" style="color:#888;margin-top:8px;text-align:center;font-weight:700;">⬆️ Select a course above</div></div>
        <div style="margin-bottom:20px;"><label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">📅 Select Year</label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            <button class="year-btn btn-3d-sm-white-glow" data-value="1">1st Year</button>
            <button class="year-btn btn-3d-sm-white-glow" data-value="2">2nd Year</button>
            <button class="year-btn btn-3d-sm-white-glow" data-value="3">3rd Year</button>
        </div>
        <div id="selectedYearDisplay" style="color:#888;margin-top:8px;text-align:center;font-weight:700;">⬆️ Select a year above</div></div>
        <div id="specializationSection" style="margin-bottom:25px;display:none;">
            <label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">🎯 Select Specialization</label>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
                <button class="spec-btn btn-3d-sm-white-glow" data-value="AI ML">🤖 AI ML</button>
                <button class="spec-btn btn-3d-sm-white-glow" data-value="Data Science">📊 Data Science</button>
                <button class="spec-btn btn-3d-sm-white-glow" data-value="General">📚 General</button>
            </div>
            <div id="selectedSpecDisplay" style="color:#888;margin-top:8px;text-align:center;font-weight:700;">⬆️ Select specialization above</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button id="confirmJoinBtn" class="btn-3d-white-glow" disabled style="opacity:0.5;">⚠️ SELECT ALL</button>
            <button id="cancelJoinBtn" class="btn-3d-sm-white-glow-danger">❌ CANCEL</button>
        </div>
        <div id="joinMessage" style="color:#888;text-align:center;margin-top:12px;"></div>
    `;
    overlay.appendChild(modal); document.body.appendChild(overlay);
    // Course buttons
    modal.querySelectorAll('.course-btn').forEach(btn=>{
        btn.addEventListener('click',function(){
            modal.querySelectorAll('.course-btn').forEach(b=>{b.style.opacity='0.5';b.style.transform='scale(0.95)';});
            this.style.opacity='1'; this.style.transform='scale(1)';
            selectedCourse=this.dataset.value;
            document.getElementById('selectedCourseDisplay').textContent='✅ '+selectedCourse;
            document.getElementById('selectedCourseDisplay').style.color='#00b894';
            if(selectedCourse==='BCA'){ document.getElementById('specializationSection').style.display='block'; }
            else{ document.getElementById('specializationSection').style.display='none'; selectedSpecialization=null; document.getElementById('selectedSpecDisplay').textContent='Not needed'; document.getElementById('selectedSpecDisplay').style.color='#888'; }
            checkAllSelected();
        });
    });
    modal.querySelectorAll('.year-btn').forEach(btn=>{
        btn.addEventListener('click',function(){
            modal.querySelectorAll('.year-btn').forEach(b=>{b.style.opacity='0.5';b.style.transform='scale(0.95)';});
            this.style.opacity='1'; this.style.transform='scale(1)';
            selectedYear=this.dataset.value;
            const yearText=selectedYear==='1'?'1st Year':selectedYear==='2'?'2nd Year':'3rd Year';
            document.getElementById('selectedYearDisplay').textContent='✅ '+yearText;
            document.getElementById('selectedYearDisplay').style.color='#00b894';
            checkAllSelected();
        });
    });
    modal.querySelectorAll('.spec-btn').forEach(btn=>{
        btn.addEventListener('click',function(){
            modal.querySelectorAll('.spec-btn').forEach(b=>{b.style.opacity='0.5';b.style.transform='scale(0.95)';});
            this.style.opacity='1'; this.style.transform='scale(1)';
            selectedSpecialization=this.dataset.value;
            document.getElementById('selectedSpecDisplay').textContent='✅ '+selectedSpecialization;
            document.getElementById('selectedSpecDisplay').style.color='#00b894';
            checkAllSelected();
        });
    });
    function checkAllSelected(){
        const confirmBtn=document.getElementById('confirmJoinBtn');
        if(selectedCourse&&selectedYear){
            if(selectedCourse==='BCA'&&!selectedSpecialization){
                confirmBtn.disabled=true; confirmBtn.textContent='⚠️ SELECT SPECIALIZATION'; confirmBtn.style.opacity='0.5'; return;
            }
            confirmBtn.disabled=false; confirmBtn.textContent='✅ CONFIRM & JOIN'; confirmBtn.style.opacity='1';
        } else {
            confirmBtn.disabled=true; confirmBtn.textContent='⚠️ SELECT ALL FIELDS'; confirmBtn.style.opacity='0.5';
        }
    }
    document.getElementById('cancelJoinBtn').addEventListener('click',function(){ document.body.removeChild(overlay); });
    document.getElementById('confirmJoinBtn').addEventListener('click',async function(){
        const msg=document.getElementById('joinMessage');
        if(!selectedCourse||!selectedYear||(selectedCourse==='BCA'&&!selectedSpecialization)){
            msg.textContent='Please select all fields'; msg.style.color='#ff6b6b'; return;
        }
        this.textContent='⏳ PROCESSING...'; this.disabled=true;
        const {data:{user}}=await client.auth.getUser();
        if(!user){ alert('Please login first.'); document.body.removeChild(overlay); return; }
        const {error}=await client.from('college_join_requests').insert({
            student_id:user.id,college_id:collegeId,
            course:selectedCourse,year_of_study:parseInt(selectedYear),
            specialization:selectedSpecialization
        });
        if(error){ msg.textContent='Error: '+error.message; msg.style.color='#ff6b6b'; return; }
        msg.textContent='✅ Join request submitted! Your ID will be assigned after approval.';
        msg.style.color='#00b894';
        setTimeout(()=>{ document.body.removeChild(overlay); loadStudentColleges(); },2000);
    });
    overlay.addEventListener('click',function(e){ if(e.target===overlay) document.body.removeChild(overlay); });
}

// ===== VIEW PROFILE =====
async function viewProfile(userId){
    selectedProfileId=userId;
    const {data:profile,error}=await client.from("profiles").select("id,full_name,inter_rivalry_id,role").eq("id",userId).single();
    if(error||!profile){ alert("Unable to load profile."); return; }
    document.getElementById("viewProfileName").textContent=profile.full_name||"User";
    document.getElementById("viewProfileRivalry").textContent=profile.inter_rivalry_id||"-";
    const {data:membership}=await client.from("college_memberships").select("course,year_of_study,specialization,colleges(college_name)").eq("user_id",userId).eq("is_active",true).maybeSingle();
    document.getElementById("viewProfileCollege").textContent=(membership&&membership.colleges)?membership.colleges.college_name:"College info unavailable";
    const skillsBox=document.getElementById("viewProfileSkills");
    skillsBox.innerHTML="<div class='empty-box'>Loading skills...</div>";
    const {data:skills}=await client.from("participations").select("subcategory_id,subcategories(id,name,categories(name))").eq("user_id",userId);
    if(!skills||skills.length===0){ skillsBox.innerHTML="<div class='empty-box'>No skills yet.</div>"; } else {
        skillsBox.innerHTML="";
        skills.forEach(row=>{
            const skill=row.subcategories;
            if(!skill) return;
            const item=document.createElement("div");
            item.className="skill-item";
            item.innerHTML=`<strong>${escapeHTML(skill.name)}</strong><div style="color:#777;margin-top:5px">${escapeHTML(skill.categories?skill.categories.name:"Skill")}</div>`;
            skillsBox.appendChild(item);
        });
    }
    const {data:profileChallenges}=await client.from("challenges").select("id,challenger_id,opponent_id,status,rules").or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`);
    const completed=(profileChallenges||[]).filter(c=>c.status==="completed");
    const wins=completed.filter(c=>c.rules?.winner_id===userId).length;
    const losses=completed.filter(c=>c.rules?.winner_id&&c.rules.winner_id!==userId&&c.rules.result!=="draw").length;
    const draws=completed.filter(c=>c.rules?.result==="draw").length;
    document.getElementById("viewProfileStats").innerHTML=`<div class="stat-grid"><div class="rival-stat"><div class="num">${wins}</div><div class="lbl">Wins</div></div><div class="rival-stat"><div class="num">${losses}</div><div class="lbl">Losses</div></div><div class="rival-stat"><div class="num">${draws}</div><div class="lbl">Draws</div></div></div>`;
    const interests=[...(skills||[])].map(x=>x.subcategories?.name).filter(Boolean);
    document.getElementById("viewProfileInterests").innerHTML=interests.length?`<h2 style="margin-bottom:10px">🎯 Interests</h2><div>${interests.map(x=>`<span class="category-tag">${escapeHTML(x)}</span>`).join("")}</div>`:"";
    showOnlyProfile();
}

// ===== OPEN CHALLENGE =====
async function openChallengePage(){
    if(!selectedProfileId){ alert("No opponent selected."); return; }
    const {data:{user}}=await client.auth.getUser();
    if(!user){ alert("Please login first."); return; }
    if(user.id===selectedProfileId){ alert("You cannot challenge yourself."); return; }
    const {data:opponent}=await client.from("profiles").select("full_name,inter_rivalry_id").eq("id",selectedProfileId).single();
    if(!opponent){ alert("Opponent not found."); return; }
    document.getElementById("challengeOpponentName").textContent=opponent.full_name||"User";
    document.getElementById("challengeOpponentId").textContent=opponent.inter_rivalry_id||"-";
    await loadChallengeSkills();
    showOnlyChallenge();
}

async function loadChallengeSkills(){
    const select=document.getElementById("challengeSkill");
    select.innerHTML="<option value=''>Loading skills...</option>";
    const {data,error}=await client.from("subcategories").select("id,name,categories(name)").order("name");
    if(error||!data||data.length===0){ select.innerHTML="<option value=''>No skills available</option>"; return; }
    select.innerHTML="<option value=''>Select a skill</option>";
    data.forEach(skill=>{
        const option=document.createElement("option");
        option.value=skill.id;
        option.textContent=skill.categories?skill.categories.name+" • "+skill.name:skill.name;
        select.appendChild(option);
    });
}

// ===== CHALLENGE MODE =====
function setChallengeMode(mode){
    selectedChallengeMode=mode==="team"?"team":"solo";
    document.getElementById("soloModeBtn").classList.toggle("active",selectedChallengeMode==="solo");
    document.getElementById("teamModeBtn").classList.toggle("active",selectedChallengeMode==="team");
    document.getElementById("teamChallengeFields").style.display=selectedChallengeMode==="team"?"grid":"none";
    if(selectedChallengeMode==="team") loadMyChallengeTeams();
}

async function loadMyChallengeTeams(){
    const select=document.getElementById("challengeMyTeam");
    if(!select) return;
    select.innerHTML="<option value=''>Loading...</option>";
    const {data:{user}}=await client.auth.getUser();
    if(!user){ select.innerHTML="<option value=''>Please login</option>"; return; }
    const {data:members,error}=await client.from("team_members").select("team_id, teams(id,name,college_id)").eq("user_id",user.id);
    if(error||!members||members.length===0){ select.innerHTML="<option value=''>No teams found</option>"; return; }
    const teams=(members||[]).map(x=>x.teams).filter(Boolean);
    select.innerHTML="<option value=''>Select your team</option>";
    teams.forEach(team=>{ const o=document.createElement("option"); o.value=team.id; o.textContent=team.name; select.appendChild(o); });
}

async function loadOpponentTeams(){
    const myTeamId=document.getElementById("challengeMyTeam")?.value;
    const select=document.getElementById("challengeOpponentTeam");
    if(!select||!myTeamId){ select.innerHTML="<option value=''>Select your team first</option>"; return; }
    select.innerHTML="<option value=''>Loading...</option>";
    const {data:myTeam}=await client.from("teams").select("college_id").eq("id",myTeamId).single();
    if(!myTeam){ select.innerHTML="<option value=''>Error loading team</option>"; return; }
    const {data:teams}=await client.from("teams").select("id,name,college_id").neq("id",myTeamId).order("name",{ascending:true});
    const opponents=(teams||[]).filter(t=>t.college_id!==myTeam.college_id);
    if(!opponents.length){ select.innerHTML="<option value=''>No opponent teams</option>"; return; }
    select.innerHTML="<option value=''>Select opponent team</option>";
    opponents.forEach(team=>{ const o=document.createElement("option"); o.value=team.id; o.textContent=team.name; select.appendChild(o); });
}

// ===== SEND CHALLENGE =====
async function sendChallenge(){
    const {data:{user}}=await client.auth.getUser();
    if(!user) return alert("Please login first.");
    if(!selectedProfileId) return alert("No opponent selected.");
    if(user.id===selectedProfileId) return alert("You cannot challenge yourself.");
    const subcategoryId=document.getElementById("challengeSkill")?.value;
    const title=document.getElementById("challengeTitle")?.value.trim();
    const description=document.getElementById("challengeDescription")?.value.trim();
    const startValue=document.getElementById("challengeStart")?.value;
    const endValue=document.getElementById("challengeEnd")?.value;
    const message=document.getElementById("challengeMessage");
    if(!subcategoryId) return message.textContent="Select a skill.";
    if(!title) return message.textContent="Enter a title.";
    if(!startValue||!endValue) return message.textContent="Select start and end times.";
    const startDate=new Date(startValue), endDate=new Date(endValue);
    if(endDate<=startDate) return message.textContent="End time must be after start.";
    let myTeamId=null, opponentTeamId=null;
    if(selectedChallengeMode==="team"){
        myTeamId=document.getElementById("challengeMyTeam")?.value||null;
        opponentTeamId=document.getElementById("challengeOpponentTeam")?.value||null;
        if(!myTeamId||!opponentTeamId) return message.textContent="Select both teams.";
    }
    const {data:existing}=await client.from("challenges").select("id").eq("challenger_id",user.id).eq("opponent_id",selectedProfileId).eq("status","pending").limit(1);
    if(existing?.length) return message.textContent="You already have a pending challenge.";
    message.textContent="Sending challenge...";
    const {data:challenge,error}=await client.from("challenges").insert({
        challenger_id:user.id, opponent_id:selectedProfileId, subcategory_id:subcategoryId,
        title, description:description||null, rules:{},
        starts_at:startDate.toISOString(), ends_at:endDate.toISOString(),
        status:"pending", mode:selectedChallengeMode
    }).select("id").single();
    if(error){ message.textContent="Error: "+error.message; return; }
    if(selectedChallengeMode==="team"){
        const {error:teamError}=await client.from("challenge_teams").insert([
            {challenge_id:challenge.id, team_id:myTeamId, side:"challenger"},
            {challenge_id:challenge.id, team_id:opponentTeamId, side:"opponent"}
        ]);
        if(teamError){ await client.from("challenges").delete().eq("id",challenge.id); message.textContent="Team error: "+teamError.message; return; }
    }
    message.textContent=selectedChallengeMode==="team"?"Team challenge sent! 👥⚔️":"Challenge sent! ⚔️";
    document.getElementById("challengeTitle").value="";
    document.getElementById("challengeDescription").value="";
    setChallengeMode("solo");
    await sendChallengeNotification(challenge.id, user.id, selectedProfileId);
}

// ===== MY CHALLENGES =====
async function loadMyChallenges(){
    const list=document.getElementById("myChallengesList");
    list.innerHTML="<div class='empty-box'>Loading challenges...</div>";
    const {data:{user}}=await client.auth.getUser();
    if(!user) return;
    const {data,error}=await client.from("challenges").select(`id,challenger_id,opponent_id,title,description,starts_at,ends_at,status,created_at,subcategory_id,rules,subcategories(name,categories(name))`).or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`).order("created_at",{ascending:false});
    if(error||!data?.length){ list.innerHTML="<div class='empty-box'>No challenges yet.</div>"; return; }
    list.innerHTML="";
    for(const c of data){
        const sender=c.challenger_id===user.id;
        const otherId=sender?c.opponent_id:c.challenger_id;
        const {data:p}=await client.from("profiles").select("full_name,inter_rivalry_id").eq("id",otherId).maybeSingle();
        const skill=c.subcategories?((c.subcategories.categories?.name?c.subcategories.categories.name+" • ":"")+c.subcategories.name):"Skill";
        const card=document.createElement("div"); card.className="challenge-card";
        let actions="";
        if(c.status==="pending"&&!sender){
            actions=`<div class="action-row"><button class="btn-3d-sm-white-glow" onclick="updateChallengeStatus('${c.id}','accepted')">✅ ACCEPT</button><button class="btn-3d-sm-white-glow-danger" onclick="updateChallengeStatus('${c.id}','declined')">❌ REJECT</button></div>`;
        } else if(c.status==="pending"&&sender){
            actions=`<div class="action-row"><button class="btn-3d-sm-white-glow-danger" onclick="deleteChallenge('${c.id}')">🗑️ DELETE</button></div>`;
        } else if(c.status==="accepted"){
            actions=`<div class="action-row"><button class="btn-3d-sm-white-glow" onclick="recordChallengeResult('${c.id}')">🏆 REPORT RESULT</button>${sender?`<button class="btn-3d-sm-white-glow-danger" onclick="deleteChallenge('${c.id}')">🗑️ DELETE</button>`:""}</div>`;
        } else if(c.status==="completed"){
            let winner=c.rules?.result==="draw"?"Draw":c.rules?.winner_id===user.id?"You won":(c.rules?.winner_name||"Opponent won");
            actions=`<div class="challenge-info" style="margin-top:12px"><strong>Result:</strong> ${escapeHTML(winner)}${c.rules?.my_score!==undefined?`<br><strong>Score:</strong> ${escapeHTML(c.rules.my_score)} - ${escapeHTML(c.rules.opponent_score)}`:""}</div>`;
        }
        card.innerHTML=`<h3>⚔️ ${escapeHTML(c.title)}</h3><div class="challenge-info"><strong>${sender?"Opponent":"Challenger"}:</strong> ${escapeHTML(p?.full_name||"User")}<br><strong>ID:</strong> ${escapeHTML(p?.inter_rivalry_id||"-")}<br><strong>Skill:</strong> ${escapeHTML(skill)}<br><strong>Status:</strong> <span class="status-pill status-${escapeHTML(c.status||"")}">${escapeHTML(c.status||"-")}</span><br><strong>Starts:</strong> ${formatDate(c.starts_at)}<br><strong>Ends:</strong> ${formatDate(c.ends_at)}${c.description?`<br><strong>Description:</strong> ${escapeHTML(c.description)}`:""}</div>${actions}`;
        list.appendChild(card);
    }
}

async function updateChallengeStatus(challengeId,status){
    const label=status==="accepted"?"accept":"reject";
    if(!confirm(`Are you sure you want to ${label} this challenge?`)) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:c}=await client.from("challenges").select("opponent_id,status").eq("id",challengeId).single();
    if(!c||c.opponent_id!==user.id||c.status!=="pending") return alert("Cannot update this challenge.");
    const {error}=await client.from("challenges").update({status}).eq("id",challengeId);
    if(error) return alert("Error: "+error.message);
    if(status==="accepted"){
        const {data:challenge}=await client.from("challenges").select("challenger_id,opponent_id").eq("id",challengeId).single();
        if(challenge){ await sendChallengeAcceptedNotification(challengeId, challenge.challenger_id, challenge.opponent_id); }
    }
    await loadMyChallenges();
}

async function deleteChallenge(challengeId){
    if(!confirm("Delete this challenge?")) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {error}=await client.from("challenges").delete().eq("id",challengeId).eq("challenger_id",user.id);
    if(error) return alert("Error: "+error.message);
    await loadMyChallenges();
}

async function recordChallengeResult(challengeId) {
    const {data:{user}}=await client.auth.getUser();
    if(!user) return;
    const {data:c}=await client.from("challenges").select("id,challenger_id,opponent_id,status,rules").eq("id",challengeId).single();
    if(!c||c.status!=="accepted") return alert("Only accepted challenges can have results.");
    if(c.challenger_id!==user.id&&c.opponent_id!==user.id) return alert("You are not in this challenge.");
    const otherId=c.challenger_id===user.id?c.opponent_id:c.challenger_id;
    const {data:other}=await client.from("profiles").select("full_name").eq("id",otherId).single();
    const overlay=document.createElement('div');
    overlay.style.cssText=`position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;padding:20px;backdrop-filter:blur(10px);`;
    const modal=document.createElement('div');
    modal.style.cssText=`background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:40px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;`;
    let selectedResult=null, myScore=null, opponentScore=null;
    modal.innerHTML=`
        <h2 style="color:white;text-align:center;margin-bottom:10px;">🏆 Report Result</h2>
        <p style="color:#888;text-align:center;margin-bottom:25px;">vs ${escapeHTML(other?.full_name||"Opponent")}</p>
        <div style="margin-bottom:20px;"><label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">🏅 Who Won?</label>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;">
            <button class="result-btn-option btn-3d-sm-white-glow" data-value="me">✅ Me</button>
            <button class="result-btn-option btn-3d-sm-white-glow-danger" data-value="them">❌ Opponent</button>
            <button class="result-btn-option btn-3d-sm-white-glow" data-value="draw">🤝 Draw</button>
        </div>
        <div id="selectedResultDisplay" style="color:#888;margin-top:8px;text-align:center;">⬆️ Select result above</div></div>
        <div style="margin-bottom:20px;"><label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">📊 Your Score</label>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
            ${[0,1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="score-btn-my btn-3d-sm-white-glow" data-value="${n}">${n}</button>`).join('')}
        </div>
        <div id="selectedMyScore" style="color:#888;margin-top:8px;text-align:center;">⬆️ Select your score</div></div>
        <div style="margin-bottom:25px;"><label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">📊 Opponent Score</label>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;">
            ${[0,1,2,3,4,5,6,7,8,9,10].map(n=>`<button class="score-btn-opp btn-3d-sm-white-glow-danger" data-value="${n}">${n}</button>`).join('')}
        </div>
        <div id="selectedOppScore" style="color:#888;margin-top:8px;text-align:center;">⬆️ Select opponent score</div></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button id="confirmResultBtn" class="btn-3d-white-glow" disabled style="opacity:0.5;">⚠️ SELECT ALL</button>
            <button id="cancelResultBtn" class="btn-3d-sm-white-glow-danger">❌ CANCEL</button>
        </div>
    `;
    overlay.appendChild(modal); document.body.appendChild(overlay);
    modal.querySelectorAll('.result-btn-option').forEach(btn=>{
        btn.addEventListener('click',function(){
            modal.querySelectorAll('.result-btn-option').forEach(b=>{b.style.opacity='0.5';b.style.transform='scale(0.95)';});
            this.style.opacity='1'; this.style.transform='scale(1)';
            selectedResult=this.dataset.value;
            const text=selectedResult==='me'?'✅ I won':selectedResult==='them'?'❌ Opponent won':'🤝 Draw';
            document.getElementById('selectedResultDisplay').textContent=text;
            document.getElementById('selectedResultDisplay').style.color='#00b894';
            checkResultAllSelected();
        });
    });
    modal.querySelectorAll('.score-btn-my').forEach(btn=>{
        btn.addEventListener('click',function(){
            modal.querySelectorAll('.score-btn-my').forEach(b=>{b.style.opacity='0.5';b.style.transform='scale(0.95)';});
            this.style.opacity='1'; this.style.transform='scale(1)';
            myScore=this.dataset.value;
            document.getElementById('selectedMyScore').textContent='✅ '+myScore;
            document.getElementById('selectedMyScore').style.color='#00b894';
            checkResultAllSelected();
        });
    });
    modal.querySelectorAll('.score-btn-opp').forEach(btn=>{
        btn.addEventListener('click',function(){
            modal.querySelectorAll('.score-btn-opp').forEach(b=>{b.style.opacity='0.5';b.style.transform='scale(0.95)';});
            this.style.opacity='1'; this.style.transform='scale(1)';
            opponentScore=this.dataset.value;
            document.getElementById('selectedOppScore').textContent='✅ '+opponentScore;
            document.getElementById('selectedOppScore').style.color='#00b894';
            checkResultAllSelected();
        });
    });
    function checkResultAllSelected(){
        const confirmBtn=document.getElementById('confirmResultBtn');
        if(selectedResult&&myScore!==null&&opponentScore!==null){
            confirmBtn.disabled=false; confirmBtn.textContent='✅ CONFIRM RESULT'; confirmBtn.style.opacity='1';
        } else {
            confirmBtn.disabled=true; confirmBtn.textContent='⚠️ SELECT ALL'; confirmBtn.style.opacity='0.5';
        }
    }
    document.getElementById('cancelResultBtn').addEventListener('click',function(){ document.body.removeChild(overlay); });
    document.getElementById('confirmResultBtn').addEventListener('click',async function(){
        if(!selectedResult||myScore===null||opponentScore===null){ alert('Please select all fields'); return; }
        this.textContent='⏳ SAVING...'; this.disabled=true;
        const winnerId=selectedResult==='me'?user.id:selectedResult==='them'?otherId:null;
        const rules={...(c.rules||{}), result:selectedResult==='draw'?'draw':'win', winner_id:winnerId, my_score:myScore, opponent_score:opponentScore, recorded_by:user.id, recorded_at:new Date().toISOString(), winner_name:selectedResult==='them'?(other?.full_name||'Opponent'):null};
        const {error}=await client.from("challenges").update({status:"completed",rules}).eq("id",challengeId);
        if(error){ alert("Error: "+error.message); document.body.removeChild(overlay); return; }
        alert("🏆 Result recorded!"); document.body.removeChild(overlay); await loadMyChallenges();
    });
    overlay.addEventListener('click',function(e){ if(e.target===overlay) document.body.removeChild(overlay); });
}

// ===== INTERESTS =====
async function loadInterestsEditor(){
    const box=document.getElementById("interestEditor");
    box.innerHTML="<div class='empty-box'>Loading interests...</div>";
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const [{data:skills},{data:parts}]=await Promise.all([
        client.from("subcategories").select("id,name,categories(name)").order("name"),
        client.from("participations").select("subcategory_id").eq("user_id",user.id)
    ]);
    if(!skills||skills.length===0){ box.innerHTML="<div class='empty-box'>No skills available.</div>"; return; }
    interestSkillCache=skills; currentInterestIds=new Set((parts||[]).map(x=>x.subcategory_id));
    const groups=new Map();
    skills.forEach(s=>{ const cat=s.categories?.name||"Other"; if(!groups.has(cat)) groups.set(cat,[]); groups.get(cat).push(s); });
    box.innerHTML=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([cat,items])=>
        `<div class="interest-category"><h3>${escapeHTML(cat)}</h3><div class="interest-list">${items.map(s=>`<label class="interest-item"><input type="checkbox" class="interest-check" value="${escapeHTML(s.id)}" ${currentInterestIds.has(s.id)?"checked":""}>${escapeHTML(s.name)}</label>`).join("")}</div></div>`
    ).join("");
}

async function saveInterests(){
    const message=document.getElementById("interestMessage");
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const selected=[...document.querySelectorAll(".interest-check:checked")].map(x=>x.value);
    message.textContent="Saving...";
    const keep=new Set(selected);
    const toDelete=[...currentInterestIds].filter(id=>!keep.has(id));
    if(toDelete.length){ await client.from("participations").delete().eq("user_id",user.id).in("subcategory_id",toDelete); }
    const toInsert=selected.filter(id=>!currentInterestIds.has(id)).map(id=>({user_id:user.id,subcategory_id:id}));
    if(toInsert.length){ await client.from("participations").insert(toInsert); }
    currentInterestIds=new Set(selected);
    message.textContent="✅ Interests saved! 🎯";
    await loadMyInterestSummary();
}

async function loadMyInterestSummary(){
    const box=document.getElementById("myInterestSummary");
    if(!box) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data}=await client.from("participations").select("subcategories(name,categories(name))").eq("user_id",user.id);
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>`<span class="category-tag">${escapeHTML(x.subcategories?.categories?.name||"Skill")} • ${escapeHTML(x.subcategories?.name||"")}</span>`).join(""):"<span style='color:#777'>No interests selected.</span>";
}

async function loadMyQuickStats(){
    const box=document.getElementById("myQuickStats"); if(!box) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data}=await client.from("challenges").select("status,rules,challenger_id,opponent_id").or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`);
    const rows=data||[];
    const wins=rows.filter(c=>c.status==="completed"&&c.rules?.winner_id===user.id).length;
    const completed=rows.filter(c=>c.status==="completed").length;
    const pending=rows.filter(c=>c.status==="pending").length;
    box.innerHTML=`<div class="stat-grid"><div class="rival-stat"><div class="num">${wins}</div><div class="lbl">Wins</div></div><div class="rival-stat"><div class="num">${completed}</div><div class="lbl">Completed</div></div><div class="rival-stat"><div class="num">${pending}</div><div class="lbl">Pending</div></div></div>`;
}

async function loadResults(){
    const list=document.getElementById("resultsList"), stats=document.getElementById("resultStats");
    list.innerHTML="<div class='empty-box'>Loading results...</div>";
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data,error}=await client.from("challenges").select("id,challenger_id,opponent_id,title,starts_at,ends_at,rules,subcategory_id,subcategories(name,categories(name))").eq("status","completed").or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`).order("ends_at",{ascending:false});
    if(error||!data?.length){ list.innerHTML="<div class='empty-box'>No completed challenges.</div>"; return; }
    const rows=data;
    const wins=rows.filter(c=>c.rules?.winner_id===user.id).length;
    const draws=rows.filter(c=>c.rules?.result==="draw").length;
    const losses=rows.length-wins-draws;
    stats.innerHTML=`<div class="rival-stat"><div class="num">${wins}</div><div class="lbl">Wins</div></div><div class="rival-stat"><div class="num">${losses}</div><div class="lbl">Losses</div></div><div class="rival-stat"><div class="num">${draws}</div><div class="lbl">Draws</div></div><div class="rival-stat"><div class="num">${rows.length}</div><div class="lbl">Total</div></div>`;
    list.innerHTML="";
    for(const c of rows){
        const otherId=c.challenger_id===user.id?c.opponent_id:c.challenger_id;
        const {data:p}=await client.from("profiles").select("full_name,inter_rivalry_id").eq("id",otherId).maybeSingle();
        const winner=c.rules?.result==="draw"?"DRAW":c.rules?.winner_id===user.id?"WIN":"LOSS";
        const skill=c.subcategories?((c.subcategories.categories?.name?c.subcategories.categories.name+" • ":"")+c.subcategories.name):"Skill";
        const card=document.createElement("div"); card.className="challenge-card";
        card.innerHTML=`<h3>🏆 ${escapeHTML(c.title)}</h3><div class="challenge-info"><strong>Opponent:</strong> ${escapeHTML(p?.full_name||"User")}<br><strong>ID:</strong> ${escapeHTML(p?.inter_rivalry_id||"-")}<br><strong>Skill:</strong> ${escapeHTML(skill)}<br><strong>Result:</strong> ${escapeHTML(winner)}<br><strong>Score:</strong> ${escapeHTML(c.rules?.my_score??"-")} - ${escapeHTML(c.rules?.opponent_score??"-")}<br><strong>Completed:</strong> ${formatDate(c.ends_at)}</div>`;
        list.appendChild(card);
    }
}

// ===== LEADERBOARD =====
function getRank(winRate,points){
    if(winRate>=90&&points>=10) return {rank:'S',label:'LEGEND',color:'#ffd700',emoji:'👑'};
    if(winRate>=75&&points>=7) return {rank:'A',label:'ELITE',color:'#00b894',emoji:'⭐'};
    if(winRate>=60&&points>=5) return {rank:'B',label:'PRO',color:'#00d2ff',emoji:'💪'};
    if(winRate>=45&&points>=3) return {rank:'C',label:'CONTENDER',color:'#fdcb6e',emoji:'📈'};
    if(winRate>=30&&points>=1) return {rank:'D',label:'RISING',color:'#e17055',emoji:'🏃'};
    return {rank:'E',label:'ROOKIE',color:'#636e72',emoji:'🌱'};
}

async function loadLeaderboard(filter){
    currentLeaderboardFilter=filter;
    document.querySelectorAll('.filter-btn').forEach(btn=>{
        btn.style.opacity='0.5'; btn.style.transform='scale(0.95)';
    });
    const btnId=filter==='overall'?'lbOverall':filter==='bca'?'lbBCA':filter==='bba'?'lbBBA':'lbBCOM';
    const activeBtn=document.getElementById(btnId);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
    const list=document.getElementById("leaderboardList");
    const myRankCard=document.getElementById("myRankCard");
    list.innerHTML="<div class='empty-box'>Loading rankings...</div>";
    const {data:{user}}=await client.auth.getUser();
    if(!user) return;
    const {data:profiles}=await client.from("profiles").select("id, full_name, inter_rivalry_id, role").eq("role","student");
    if(!profiles||profiles.length===0){ list.innerHTML="<div class='empty-box'>No students found.</div>"; return; }
    const userIds=profiles.map(p=>p.id);
    const {data:challenges}=await client.from("challenges").select("challenger_id, opponent_id, status, rules, subcategory_id, subcategories(name, categories(name))").in("challenger_id",userIds).eq("status","completed");
    const userStats={};
    profiles.forEach(p=>{
        userStats[p.id]={...p, wins:0, losses:0, draws:0, total:0, winRate:0, points:0, skillWins:{}, course:null, year:null, college:null, specialization:null, rank:'E', rankLabel:'ROOKIE', rankColor:'#636e72', rankEmoji:'🌱'};
    });
    const {data:memberships}=await client.from("college_memberships").select("user_id, course, year_of_study, specialization, colleges(college_name)").in("user_id",userIds).eq("is_active",true);
    memberships?.forEach(m=>{
        if(userStats[m.user_id]){
            userStats[m.user_id].course=m.course;
            userStats[m.user_id].year=m.year_of_study;
            userStats[m.user_id].college=m.colleges?.college_name||'Unknown';
            userStats[m.user_id].specialization=m.specialization;
        }
    });
    challenges?.forEach(c=>{
        const challenger=userStats[c.challenger_id];
        const opponent=userStats[c.opponent_id];
        const rules=c.rules||{};
        if(rules.winner_id){
            if(rules.winner_id===c.challenger_id&&challenger){
                challenger.wins++; challenger.total++; challenger.points+=3;
                const skillName=c.subcategories?.name||'Unknown';
                if(!challenger.skillWins[skillName]) challenger.skillWins[skillName]=0;
                challenger.skillWins[skillName]++;
                if(opponent){ opponent.losses++; opponent.total++; }
            } else if(rules.winner_id===c.opponent_id&&opponent){
                opponent.wins++; opponent.total++; opponent.points+=3;
                const skillName=c.subcategories?.name||'Unknown';
                if(!opponent.skillWins[skillName]) opponent.skillWins[skillName]=0;
                opponent.skillWins[skillName]++;
                if(challenger){ challenger.losses++; challenger.total++; }
            }
        } else if(rules.result==='draw'){
            if(challenger){ challenger.draws++; challenger.total++; challenger.points+=1; }
            if(opponent){ opponent.draws++; opponent.total++; opponent.points+=1; }
        }
    });
    Object.values(userStats).forEach(u=>{
        u.winRate=u.total>0?Math.round((u.wins/u.total)*100):0;
        const rankInfo=getRank(u.winRate,u.points);
        u.rank=rankInfo.rank; u.rankLabel=rankInfo.label; u.rankColor=rankInfo.color; u.rankEmoji=rankInfo.emoji;
    });
    let filtered=Object.values(userStats);
    if(filter==='bca'){ filtered=filtered.filter(u=>u.course==='BCA'); }
    else if(filter==='bba'){ filtered=filtered.filter(u=>u.course==='BBA'); }
    else if(filter==='bcom'){ filtered=filtered.filter(u=>u.course==='B.COM'); }
    const rankOrder={'S':0,'A':1,'B':2,'C':3,'D':4,'E':5};
    filtered.sort((a,b)=>{ const diff=rankOrder[a.rank]-rankOrder[b.rank]; if(diff!==0) return diff; return b.points-a.points; });
    const topPlayers=filtered.slice(0,50);
    leaderboardData=topPlayers;
    const currentUser=userStats[user.id];
    if(currentUser){
        currentUserRank=currentUser;
        const rankInfo=getRank(currentUser.winRate,currentUser.points);
        myRankCard.innerHTML=`
            <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border:2px solid ${rankInfo.color};border-radius:16px;padding:25px;text-align:center;">
                <div style="font-size:14px;color:#888;margin-bottom:5px;">YOUR RANK</div>
                <div style="font-size:60px;font-weight:900;color:${rankInfo.color};line-height:1;">${rankInfo.rank}</div>
                <div style="font-size:20px;font-weight:700;color:${rankInfo.color};margin-top:5px;">${rankInfo.emoji} ${rankInfo.label}</div>
                <div style="display:flex;justify-content:center;gap:30px;margin-top:15px;flex-wrap:wrap;">
                    <div><span style="color:#888;">Points</span><br><span style="font-size:20px;font-weight:700;color:#00d2ff;">${currentUser.points}</span></div>
                    <div><span style="color:#888;">Wins</span><br><span style="font-size:20px;font-weight:700;color:#00b894;">${currentUser.wins}</span></div>
                    <div><span style="color:#888;">Losses</span><br><span style="font-size:20px;font-weight:700;color:#e17055;">${currentUser.losses}</span></div>
                    <div><span style="color:#888;">Win Rate</span><br><span style="font-size:20px;font-weight:700;color:${rankInfo.color};">${currentUser.winRate}%</span></div>
                </div>
                ${currentUser.course?`<div style="margin-top:10px;color:#888;font-size:14px;">${escapeHTML(currentUser.course)} ${currentUser.year?'• '+(currentUser.year===1?'1st Year':currentUser.year===2?'2nd Year':'3rd Year'):''} ${currentUser.specialization?'• '+escapeHTML(currentUser.specialization):''}</div>`:''}
            </div>
        `;
    }
    if(!topPlayers.length){ list.innerHTML="<div class='empty-box'>No players found in this category.</div>"; return; }
    let html='';
    const rankColors={'S':'#ffd700','A':'#00b894','B':'#00d2ff','C':'#fdcb6e','D':'#e17055','E':'#636e72'};
    topPlayers.forEach((player,index)=>{
        const isCurrentUser=player.id===user.id;
        const rankColor=rankColors[player.rank]||'#636e72';
        html+=`
            <div style="background:${isCurrentUser?'#1a1a2e':'#121212'};border:2px solid ${isCurrentUser?rankColor:'#292929'};border-radius:12px;padding:16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:15px;transition:0.2s;">
                <div style="display:flex;align-items:center;gap:15px;">
                    <div style="font-size:36px;font-weight:900;color:${rankColor};min-width:55px;text-align:center;line-height:1;">
                        ${player.rank}
                        <div style="font-size:10px;color:#888;font-weight:400;line-height:1;">#${index+1}</div>
                    </div>
                    <div>
                        <div style="font-weight:700;font-size:18px;">${isCurrentUser?'⭐ ':''}${escapeHTML(player.full_name||'Unknown')}${isCurrentUser?'<span style="font-size:12px;color:#00d2ff;margin-left:8px;">(YOU)</span>':''}</div>
                        <div style="font-size:12px;color:#888;">ID: ${escapeHTML(player.inter_rivalry_id||'-')}</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
                            ${player.course?`<span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:#888;">${escapeHTML(player.course)}</span>`:''}
                            ${player.year?`<span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:#888;">${player.year===1?'1st Year':player.year===2?'2nd Year':'3rd Year'}</span>`:''}
                            ${player.specialization?`<span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:#888;">🎯 ${escapeHTML(player.specialization)}</span>`:''}
                            <span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:${rankColor};font-weight:700;">${player.rankEmoji} ${player.rankLabel}</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:15px;flex-wrap:wrap;">
                    <div style="text-align:center;"><div style="font-size:20px;font-weight:900;color:#00d2ff;">${player.points}</div><div style="font-size:10px;color:#888;">Points</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#00b894;">${player.wins}</div><div style="font-size:10px;color:#888;">W</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#e17055;">${player.losses}</div><div style="font-size:10px;color:#888;">L</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#fdcb6e;">${player.draws}</div><div style="font-size:10px;color:#888;">D</div></div>
                    <div style="text-align:center;min-width:55px;"><div style="font-size:18px;font-weight:900;color:${rankColor};">${player.winRate}%</div><div style="font-size:10px;color:#888;">Win Rate</div></div>
                    <button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:10px;" onclick="viewProfile('${player.id}')">👤 VIEW</button>
                </div>
            </div>
        `;
    });
    list.innerHTML=html;
}

// ===== CATEGORY RANKINGS =====
function getCategoryEmoji(category){
    const emojis={'Sports':'🏏','Education':'🎓','Culture':'🎭','Gaming':'🎮','Technology':'💻'};
    return emojis[category]||'🏆';
}

async function loadCategoryRankings(category){
    const list=document.getElementById("categoryRankingsList");
    if(!list) return;
    list.innerHTML="<div class='empty-box'>Loading category rankings...</div>";
    document.querySelectorAll('#categoryRankingsPage .filter-btn').forEach(btn=>{
        btn.style.opacity='0.5'; btn.style.transform='scale(0.95)';
    });
    const btnId=`catFilter${category==='all'?'All':category}`;
    const activeBtn=document.getElementById(btnId);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:challenges,error}=await client.from("challenges").select(`challenger_id, opponent_id, status, rules, subcategory_id, subcategories(id, name, categories(id, name))`).eq("status","completed");
    if(error||!challenges||challenges.length===0){
        list.innerHTML="<div class='empty-box'>No completed challenges yet. Start competing to see rankings!</div>";
        return;
    }
    const {data:profiles}=await client.from("profiles").select("id, full_name, inter_rivalry_id, role").eq("role","student");
    if(!profiles) return;
    const {data:memberships}=await client.from("college_memberships").select("user_id, course, year_of_study, specialization, colleges(college_name)").in("user_id",profiles.map(p=>p.id)).eq("is_active",true);
    const userMap={};
    profiles.forEach(p=>{
        const membership=memberships?.find(m=>m.user_id===p.id)||{};
        userMap[p.id]={...p, course:membership?.course||'Unknown', year:membership?.year_of_study||null, specialization:membership?.specialization||null, college:membership?.colleges?.college_name||'Unknown'};
    });
    const categoryStats={};
    const userStats={};
    challenges.forEach(c=>{
        const challengerId=c.challenger_id, opponentId=c.opponent_id, rules=c.rules||{}, subcategory=c.subcategories;
        const categoryName=subcategory?.categories?.name||'Unknown', gameName=subcategory?.name||'Unknown';
        if(!categoryStats[categoryName]) categoryStats[categoryName]={};
        if(!categoryStats[categoryName][gameName]) categoryStats[categoryName][gameName]={};
        if(rules.winner_id){
            const winnerId=rules.winner_id, loserId=winnerId===challengerId?opponentId:challengerId;
            if(!userStats[winnerId]) userStats[winnerId]={wins:0,losses:0,draws:0,total:0,games:{}};
            if(!userStats[winnerId].games[gameName]) userStats[winnerId].games[gameName]={wins:0,losses:0,draws:0,total:0};
            userStats[winnerId].wins++; userStats[winnerId].total++; userStats[winnerId].games[gameName].wins++; userStats[winnerId].games[gameName].total++;
            if(!userStats[loserId]) userStats[loserId]={wins:0,losses:0,draws:0,total:0,games:{}};
            if(!userStats[loserId].games[gameName]) userStats[loserId].games[gameName]={wins:0,losses:0,draws:0,total:0};
            userStats[loserId].losses++; userStats[loserId].total++; userStats[loserId].games[gameName].losses++; userStats[loserId].games[gameName].total++;
            if(!categoryStats[categoryName][gameName][winnerId]) categoryStats[categoryName][gameName][winnerId]=0;
            categoryStats[categoryName][gameName][winnerId]++;
        } else if(rules.result==='draw'){
            [challengerId,opponentId].forEach(id=>{
                if(!userStats[id]) userStats[id]={wins:0,losses:0,draws:0,total:0,games:{}};
                if(!userStats[id].games[gameName]) userStats[id].games[gameName]={wins:0,losses:0,draws:0,total:0};
                userStats[id].draws++; userStats[id].total++; userStats[id].games[gameName].draws++; userStats[id].games[gameName].total++;
            });
        }
    });
    Object.keys(userStats).forEach(userId=>{
        const stats=userStats[userId];
        stats.winRate=stats.total>0?Math.round((stats.wins/stats.total)*100):0;
        Object.keys(stats.games).forEach(gameName=>{
            const game=stats.games[gameName];
            game.winRate=game.total>0?Math.round((game.wins/game.total)*100):0;
            const rankInfo=getRank(game.winRate,game.wins*3+game.draws);
            game.rank=rankInfo.rank; game.rankLabel=rankInfo.label; game.rankColor=rankInfo.color; game.rankEmoji=rankInfo.emoji;
        });
    });
    let html='';
    const categories=Object.keys(categoryStats).sort();
    const filteredCategories=category==='all'?categories:categories.filter(c=>c===category);
    if(filteredCategories.length===0){
        list.innerHTML=`<div class='empty-box'>No rankings found for ${category} category.</div>`;
        return;
    }
    filteredCategories.forEach(catName=>{
        const games=Object.keys(categoryStats[catName]).sort();
        html+=`<div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:23px;margin-bottom:20px;">
            <h2 style="color:#fdcb6e;margin-bottom:15px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">${getCategoryEmoji(catName)}</span>
                ${escapeHTML(catName)}
                <span style="font-size:14px;color:#888;font-weight:400;">(${games.length} games)</span>
            </h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px;">`;
        games.forEach(gameName=>{
            const players=categoryStats[catName][gameName];
            const playerIds=Object.keys(players);
            playerIds.sort((a,b)=>players[b]-players[a]);
            const topPlayers=playerIds.slice(0,10);
            html+=`<div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:16px;">
                <h3 style="color:#00d2ff;margin-bottom:12px;font-size:16px;">🎯 ${escapeHTML(gameName)}</h3>
                <div style="display:flex;flex-direction:column;gap:6px;">`;
            if(topPlayers.length===0){
                html+=`<div style="color:#888;font-size:12px;text-align:center;padding:10px;">No players yet</div>`;
            } else {
                topPlayers.forEach((playerId,index)=>{
                    const player=userMap[playerId];
                    const stats=userStats[playerId];
                    const gameStats=stats?.games[gameName]||{wins:0,losses:0,draws:0,total:0,winRate:0,rank:'E',rankColor:'#636e72',rankEmoji:'🌱'};
                    const wins=players[playerId]||0;
                    let medal='', bgColor='#0a0a0a';
                    if(index===0){ medal='🥇'; bgColor='#1a1508'; } else if(index===1){ medal='🥈'; bgColor='#151515'; } else if(index===2){ medal='🥉'; bgColor='#1a0f0a'; }
                    html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${bgColor};border-radius:8px;border-left:3px solid ${gameStats.rankColor||'#636e72'};">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <span style="font-size:16px;min-width:30px;">${medal||`#${index+1}`}</span>
                            <div><span style="font-weight:600;">${escapeHTML(player?.full_name||'Unknown')}</span>
                            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
                                <span style="font-size:10px;color:#888;">${escapeHTML(player?.course||'')}</span>
                                <span style="font-size:10px;color:${gameStats.rankColor||'#636e72'};font-weight:700;">${gameStats.rankEmoji||'🌱'} ${gameStats.rank||'E'}</span>
                            </div></div>
                        </div>
                        <div style="display:flex;align-items:center;gap:12px;">
                            <div style="text-align:center;"><span style="font-size:16px;font-weight:700;color:#00b894;">${wins}</span><div style="font-size:9px;color:#888;">Wins</div></div>
                            <div style="text-align:center;"><span style="font-size:14px;font-weight:600;color:${gameStats.rankColor||'#636e72'};">${gameStats.winRate||0}%</span><div style="font-size:9px;color:#888;">Rate</div></div>
                            <button class="btn-3d-xs-white-glow" style="width:auto;padding:3px 10px;font-size:9px;" onclick="viewProfile('${playerId}')">VIEW</button>
                        </div>
                    </div>`;
                });
            }
            if(playerIds.length>10){
                html+=`<div style="text-align:center;margin-top:6px;"><span style="font-size:11px;color:#555;">+${playerIds.length-10} more players</span></div>`;
            }
            html+=`</div></div>`;
        });
        html+=`</div></div>`;
    });
    list.innerHTML=html;
}

// ===== TOURNAMENTS =====
async function loadTournaments(filter){
    const list=document.getElementById("tournamentsList");
    list.innerHTML="<div class='empty-box'>Loading tournaments...</div>";
    const {data:{user}}=await client.auth.getUser();
    if(user){
        const {data:profile}=await client.from("profiles").select("role").eq("id",user.id).single();
        currentUserRole=profile?.role||'';
        const adminControls=document.getElementById("tournamentAdminControls");
        if(adminControls){ adminControls.style.display=(currentUserRole==='super_admin'||currentUserRole==='college_admin')?'block':'none'; }
    }
    document.querySelectorAll('#tournamentsPage .filter-btn').forEach(btn=>{
        btn.style.opacity='0.5'; btn.style.transform='scale(0.95)';
    });
    const btnId=`tournFilter${filter.charAt(0).toUpperCase()+filter.slice(1)}`;
    const activeBtn=document.getElementById(btnId);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
    let query=client.from("tournaments").select(`*, profiles!tournaments_created_by_fkey(full_name, inter_rivalry_id)`);
    if(filter!=='all'){ query=query.eq("status",filter); }
    const {data,error}=await query.order("start_date",{ascending:true});
    if(error){ list.innerHTML=`<div class='empty-box'>Error: ${escapeHTML(error.message)}</div>`; return; }
    if(!data||data.length===0){ list.innerHTML=`<div class='empty-box'>No ${filter!=='all'?filter:''} tournaments found.</div>`; return; }
    list.innerHTML="";
    for(const tournament of data){
        let isRegistered=false, isFull=false, participantCount=0;
        if(user){
            const {count}=await client.from("tournament_participants").select("id",{count:"exact",head:true}).eq("tournament_id",tournament.id);
            participantCount=count||0; isFull=participantCount>=tournament.max_players;
            const {data:reg}=await client.from("tournament_participants").select("id").eq("tournament_id",tournament.id).eq("user_id",user.id).maybeSingle();
            isRegistered=!!reg;
        }
        const statusColors={'upcoming':'#fdcb6e','ongoing':'#00d2ff','completed':'#00b894'};
        const statusEmojis={'upcoming':'⏳','ongoing':'⚡','completed':'✅'};
        const card=document.createElement("div"); card.className="challenge-card";
        card.innerHTML=`
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
                <div>
                    <h3>🏆 ${escapeHTML(tournament.title)}</h3>
                    <div class="challenge-info">
                        <strong>Category:</strong> ${escapeHTML(tournament.category)} • ${escapeHTML(tournament.game)}
                        <br><strong>Created by:</strong> ${escapeHTML(tournament.profiles?.full_name||'Unknown')}
                        <br><strong>Players:</strong> ${participantCount}/${tournament.max_players}
                        <br><strong>Starts:</strong> ${formatDate(tournament.start_date)}
                        <br><strong>Ends:</strong> ${formatDate(tournament.end_date)}
                        ${tournament.prize?`<br><strong>🏅 Prize:</strong> ${escapeHTML(tournament.prize)}`:''}
                        ${tournament.description?`<br><strong>Description:</strong> ${escapeHTML(tournament.description)}`:''}
                        ${tournament.rules?`<br><strong>Rules:</strong> ${escapeHTML(tournament.rules)}`:''}
                    </div>
                </div>
                <div style="text-align:right;">
                    <span class="status-pill status-${escapeHTML(tournament.status)}" style="background:${statusColors[tournament.status]||'#888'};color:${tournament.status==='upcoming'?'#2d3436':'white'};">
                        ${statusEmojis[tournament.status]} ${escapeHTML(tournament.status)}
                    </span>
                    <div style="margin-top:10px;">
                        ${tournament.status!=='completed'&&!isFull&&!isRegistered?`<button class="btn-3d-sm-white-glow" onclick="joinTournament('${tournament.id}')" style="width:auto;padding:6px 16px;">🎯 JOIN</button>`:''}
                        ${isRegistered&&tournament.status!=='completed'?`<button class="btn-3d-sm-white-glow-danger" onclick="leaveTournament('${tournament.id}')" style="width:auto;padding:6px 16px;">🚪 LEAVE</button>`:''}
                        ${isFull&&!isRegistered&&tournament.status!=='completed'?`<span style="color:#ff6b6b;font-size:12px;">🔴 FULL</span>`:''}
                        ${tournament.status==='completed'&&isRegistered?`<span style="color:#00b894;">✅ Participated</span>`:''}
                    </div>
                </div>
            </div>
        `;
        list.appendChild(card);
    }
}

function showCreateTournament(){ document.getElementById("createTournamentModal").style.display="flex"; }
function closeCreateTournament(){ document.getElementById("createTournamentModal").style.display="none"; document.getElementById("tournMessage").textContent=""; }

async function createTournament(){
    const title=document.getElementById("tournTitle").value.trim();
    const category=document.getElementById("tournCategory").value;
    const game=document.getElementById("tournGame").value.trim();
    const description=document.getElementById("tournDescription").value.trim();
    const maxPlayers=parseInt(document.getElementById("tournMaxPlayers").value);
    const startDate=document.getElementById("tournStart").value;
    const endDate=document.getElementById("tournEnd").value;
    const prize=document.getElementById("tournPrize").value.trim();
    const rules=document.getElementById("tournRules").value.trim();
    const msg=document.getElementById("tournMessage");
    if(!title||!game||!startDate||!endDate){ msg.textContent="Please fill in all required fields."; msg.style.color="#ff6b6b"; return; }
    if(new Date(endDate)<=new Date(startDate)){ msg.textContent="End time must be after start time."; msg.style.color="#ff6b6b"; return; }
    const {data:{user}}=await client.auth.getUser();
    if(!user){ msg.textContent="Please login first."; msg.style.color="#ff6b6b"; return; }
    msg.textContent="Creating tournament..."; msg.style.color="#888";
    const {data:tournament,error}=await client.from("tournaments").insert({
        title, description:description||null, category, game, max_players:maxPlayers,
        start_date:startDate, end_date:endDate,
        status:new Date(startDate)>new Date()?'upcoming':'ongoing',
        prize:prize||null, rules:rules||null, created_by:user.id
    }).select("id").single();
    if(error){ msg.textContent="Error: "+error.message; msg.style.color="#ff6b6b"; return; }
    msg.textContent="✅ Tournament created successfully!"; msg.style.color="#00b894";
    await sendNotificationToAll("🏆 New Tournament!",`A new tournament "${title}" has been created in ${category}! Join now!`,"tournament","/tournaments");
    setTimeout(()=>{ closeCreateTournament(); loadTournaments('all'); },1500);
}

async function joinTournament(tournamentId){
    const {data:{user}}=await client.auth.getUser();
    if(!user){ alert("Please login first."); return; }
    const {error}=await client.from("tournament_participants").insert({tournament_id:tournamentId,user_id:user.id});
    if(error){ alert("Could not join: "+error.message); return; }
    alert("🎯 You joined the tournament!");
    loadTournaments(document.querySelector('#tournamentsPage .filter-btn[style*="opacity: 1"]')?.id?.replace('tournFilter','').toLowerCase()||'all');
}

async function leaveTournament(tournamentId){
    if(!confirm("Are you sure you want to leave this tournament?")) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {error}=await client.from("tournament_participants").delete().eq("tournament_id",tournamentId).eq("user_id",user.id);
    if(error){ alert("Could not leave: "+error.message); return; }
    alert("You left the tournament.");
    loadTournaments(document.querySelector('#tournamentsPage .filter-btn[style*="opacity: 1"]')?.id?.replace('tournFilter','').toLowerCase()||'all');
}

// ===== NOTIFICATIONS =====
async function sendNotificationToUser(userId,title,message,type='info',link=null){
    try {
        const {error}=await client.from("notifications").insert({user_id:userId,title,message,type,link,is_read:false});
        if(error){ console.error('Error saving notification:',error); }
        sendWebNotification(title,message);
        const {data:tokens}=await client.from("device_tokens").select("token").eq("user_id",userId).eq("is_active",true);
        if(tokens&&tokens.length>0){
            await sendPushNotifications(tokens.map(t=>t.token),title,message,link);
        }
    } catch(error){ console.error('Error sending notification:',error); }
}

async function sendNotificationToAll(title,message,type='info',link=null){
    try {
        const {data:users}=await client.from("profiles").select("id");
        if(!users||users.length===0) return;
        const batchSize=100;
        for(let i=0;i<users.length;i+=batchSize){
            const batch=users.slice(i,i+batchSize);
            const notifications=batch.map(u=>({user_id:u.id,title,message,type,link,is_read:false}));
            await client.from("notifications").insert(notifications);
        }
        sendWebNotification(title,message);
        const {data:tokens}=await client.from("device_tokens").select("token");
        if(tokens&&tokens.length>0){
            await sendPushNotifications(tokens.map(t=>t.token),title,message,link);
        }
    } catch(error){ console.error('Error sending to all:',error); }
}

function sendWebNotification(title,message){
    if(!('Notification' in window)) return;
    if(Notification.permission==='granted'){
        const notification=new Notification(title,{body:message,icon:'🔔',requireInteraction:true});
        setTimeout(()=>notification.close(),10000);
    }
}

async function sendPushNotifications(tokens,title,message,link){
    try {
        const {data,error}=await client.functions.invoke('send-push',{
            body:{tokens,title,message,link:link||'/'}
        });
        if(error){ console.error('Error sending push notifications:',error); }
        return data;
    } catch(error){ console.error('Push notification error:',error); }
}

async function sendChallengeNotification(challengeId,challengerId,opponentId){
    const {data:challenger}=await client.from("profiles").select("full_name").eq("id",challengerId).single();
    if(challenger){
        await sendNotificationToUser(opponentId,'⚔️ New Challenge!',`${challenger.full_name} has challenged you!`,'challenge','/my-challenges');
    }
}

async function sendChallengeAcceptedNotification(challengeId,challengerId,opponentId){
    const {data:opponent}=await client.from("profiles").select("full_name").eq("id",opponentId).single();
    if(opponent){
        await sendNotificationToUser(challengerId,'⚔️ Challenge Accepted!',`${opponent.full_name} has accepted your challenge!`,'success','/my-challenges');
    }
}

async function loadNotifications(){
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data,error}=await client.from("notifications").select("*").eq("user_id",user.id).order("created_at",{ascending:false}).limit(50);
    if(error) return;
    const unreadCount=(data||[]).filter(n=>!n.is_read).length;
    const badge=document.getElementById("notificationBadge");
    if(badge){ badge.textContent=unreadCount; badge.style.display=unreadCount>0?'flex':'none'; }
    updateNotificationDropdown(data);
}

function updateNotificationDropdown(notifications){
    const dropdown=document.getElementById("notificationDropdown");
    if(!dropdown) return;
    if(!notifications||notifications.length===0){
        dropdown.innerHTML=`<div style="padding:20px;text-align:center;color:#888;"><div style="font-size:30px;">🔔</div><div style="margin-top:10px;">No notifications</div></div>`;
        return;
    }
    const top=notifications.slice(0,10);
    const typeIcons={'challenge':'⚔️','tournament':'🏆','grade':'📊','system':'🔔','success':'✅','warning':'⚠️','info':'ℹ️'};
    dropdown.innerHTML=top.map(n=>{
        const isRead=n.is_read;
        const icon=typeIcons[n.type]||'🔔';
        return `
            <div style="padding:12px;border-bottom:1px solid #222;cursor:pointer;${!isRead?'background:rgba(0,210,255,0.05);':''}" onclick="markNotificationRead('${n.id}')">
                <div style="display:flex;align-items:center;gap:10px;">
                    <span style="font-size:20px;">${icon}</span>
                    <div style="flex:1;min-width:0;">
                        <div style="font-weight:700;font-size:14px;color:${!isRead?'#fff':'#888'};">${escapeHTML(n.title)}</div>
                        <div style="font-size:12px;color:#888;">${escapeHTML(n.message)}</div>
                        <div style="font-size:10px;color:#555;margin-top:4px;">${formatDate(n.created_at)}</div>
                    </div>
                    ${!isRead?`<span style="width:8px;height:8px;background:#00d2ff;border-radius:50%;flex-shrink:0;"></span>`:''}
                </div>
            </div>
        `;
    }).join('');
    if(notifications.length>10){
        dropdown.innerHTML+=`<div style="padding:10px;text-align:center;color:#888;font-size:12px;">+${notifications.length-10} more notifications</div>`;
    }
}

async function markNotificationRead(notificationId){
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    await client.from("notifications").update({is_read:true}).eq("id",notificationId).eq("user_id",user.id);
    loadNotifications();
}

function toggleNotifications(){
    const dropdown=document.getElementById("notificationDropdown");
    if(!dropdown) return;
    const isVisible=dropdown.style.display==='block';
    dropdown.style.display=isVisible?'none':'block';
    if(!isVisible){ loadNotifications(); }
}

document.addEventListener('click',function(event){
    const navbar=document.querySelector('.navbar');
    if(navbar&&!navbar.contains(event.target)){
        const dropdown=document.getElementById("notificationDropdown");
        if(dropdown){ dropdown.style.display='none'; }
    }
});

// ===== GAME TOOLBOX =====
async function loadGames(){
    const grid=document.getElementById('gamesGrid');
    if(!grid) return;
    grid.innerHTML="<div class='empty-box'>Loading games...</div>";
    const {data:{user}}=await client.auth.getUser();
    if(user){
        const {data:profile}=await client.from("profiles").select("role").eq("id",user.id).single();
        currentUserRole=profile?.role||'';
        const adminControls=document.getElementById("toolboxAdminControls");
        if(adminControls){ adminControls.style.display=(currentUserRole==='super_admin'||currentUserRole==='college_admin')?'block':'none'; }
    }
    const {data,error}=await client.from("game_launchers").select("*").eq("is_active",true).order("game_name",{ascending:true});
    if(error||!data||data.length===0){
        grid.innerHTML="<div class='empty-box'>No games available. Admin can add games!</div>";
        return;
    }
    allGames=data;
    displayGames('all');
}

function displayGames(category){
    const grid=document.getElementById('gamesGrid');
    if(!grid) return;
    let filtered=allGames;
    if(category!=='all'){ filtered=allGames.filter(g=>g.category===category); }
    if(filtered.length===0){
        grid.innerHTML=`<div class='empty-box'>No games found in ${category} category.</div>`;
        return;
    }
    document.querySelectorAll('#toolboxPage .filter-btn').forEach(btn=>{
        btn.style.opacity='0.5'; btn.style.transform='scale(0.95)';
    });
    const activeBtn=document.getElementById(`gameFilter${category==='all'?'All':category}`);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
    grid.innerHTML='';
    filtered.forEach(game=>{
        const card=document.createElement('div');
        card.className='category-card';
        card.style.cursor='pointer';
        card.style.borderColor='#292929';
        card.style.transition='all 0.2s ease';
        card.onmouseenter=()=>{ card.style.borderColor='#555'; card.style.transform='translateY(-3px)'; };
        card.onmouseleave=()=>{ card.style.borderColor='#292929'; card.style.transform='translateY(0)'; };
        card.innerHTML=`
            <div style="text-align:center;">
                <div style="font-size:48px;margin-bottom:10px;">${game.icon||'🎮'}</div>
                <h3>${escapeHTML(game.game_name)}</h3>
                <p style="color:#888;font-size:12px;">${escapeHTML(game.category)}</p>
                <div style="margin-top:10px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">
                    <button class="btn-3d-sm-white-glow" style="width:auto;padding:6px 16px;font-size:12px;" onclick="launchGame('${game.id}')">🚀 LAUNCH</button>
                    ${currentUserRole==='super_admin'||currentUserRole==='college_admin'?`<button class="btn-3d-sm-white-glow-danger" style="width:auto;padding:6px 16px;font-size:12px;" onclick="deleteGame('${game.id}')">🗑️</button>`:''}
                </div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function filterGames(category){ currentGameFilter=category; displayGames(category); }

async function launchGame(gameId){
    const {data:game,error}=await client.from("game_launchers").select("*").eq("id",gameId).single();
    if(error||!game){ alert("Game not found!"); return; }
    showGameLaunchNotification(game);
    if(game.launch_url){ window.open(game.launch_url,'_blank'); } else { alert(`No URL configured for ${game.game_name}`); }
}

function showGameLaunchNotification(game){
    const notif=document.createElement('div');
    notif.style.cssText=`position:fixed;bottom:30px;right:30px;background:#1a1a1a;border:1px solid #00d2ff;border-radius:16px;padding:20px 25px;z-index:9999;box-shadow:0 0 40px rgba(0,210,255,0.2);animation:slideInUp 0.3s ease;max-width:350px;`;
    notif.innerHTML=`<div style="display:flex;align-items:center;gap:12px;"><span style="font-size:30px;">${game.icon||'🚀'}</span><div><div style="font-weight:700;color:#00d2ff;">Launching ${escapeHTML(game.game_name)}</div><div style="font-size:12px;color:#888;">Opening in new tab...</div></div></div>`;
    document.body.appendChild(notif);
    setTimeout(()=>{ notif.style.animation='slideOutDown 0.3s ease'; setTimeout(()=>notif.remove(),300); },3000);
}

const styleSheet=document.createElement("style");
styleSheet.textContent=`@keyframes slideInUp{from{transform:translateY(100px);opacity:0;}to{transform:translateY(0);opacity:1;}}@keyframes slideOutDown{from{transform:translateY(0);opacity:1;}to{transform:translateY(100px);opacity:0;}}`;
document.head.appendChild(styleSheet);

function showAddGameModal(){ document.getElementById("addGameModal").style.display="flex"; document.getElementById("gameModalMessage").textContent=""; }
function closeAddGameModal(){ document.getElementById("addGameModal").style.display="none"; document.getElementById("gameModalMessage").textContent=""; document.getElementById("gameNameInput").value=""; document.getElementById("gameUrlInput").value=""; document.getElementById("gameIconInput").value=""; }

async function saveGame(){
    const name=document.getElementById("gameNameInput").value.trim();
    const category=document.getElementById("gameCategoryInput").value;
    const url=document.getElementById("gameUrlInput").value.trim();
    const icon=document.getElementById("gameIconInput").value.trim();
    const msg=document.getElementById("gameModalMessage");
    if(!name){ msg.textContent="Please enter a game name."; msg.style.color="#ff6b6b"; return; }
    if(!url){ msg.textContent="Please enter a launch URL."; msg.style.color="#ff6b6b"; return; }
    msg.textContent="Saving game..."; msg.style.color="#888";
    const {data:{user}}=await client.auth.getUser();
    if(!user){ msg.textContent="Please login first."; msg.style.color="#ff6b6b"; return; }
    const {error}=await client.from("game_launchers").insert({game_name:name,category,launch_type:'url',launch_url:url,icon:icon||'🎮',is_active:true});
    if(error){ if(error.code==='23505'){ msg.textContent="⚠️ This game already exists!"; msg.style.color="#ff6b6b"; } else { msg.textContent="Error: "+error.message; msg.style.color="#ff6b6b"; } return; }
    msg.textContent="✅ Game added successfully!"; msg.style.color="#00b894";
    setTimeout(()=>{ closeAddGameModal(); loadGames(); },1500);
}

async function deleteGame(gameId){
    if(!confirm("Delete this game?")) return;
    const {error}=await client.from("game_launchers").update({is_active:false}).eq("id",gameId);
    if(error){ alert("Error: "+error.message); return; }
    alert("✅ Game deleted!"); loadGames();
}

// ===== QUIZ BATTLE =====
async function loadQuizCategories(category){
    selectedCategory=category;
    document.querySelectorAll('#quizBattlePage .filter-btn').forEach(btn=>{
        btn.style.opacity='0.5'; btn.style.transform='scale(0.95)';
    });
    const btnId=`quizFilter${category==='all'?'All':category}`;
    const activeBtn=document.getElementById(btnId);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
    const {data:{user}}=await client.auth.getUser();
    if(user){
        const {data:profile}=await client.from("profiles").select("role").eq("id",user.id).single();
        const adminControls=document.getElementById("quizAdminControls");
        if(adminControls){ adminControls.style.display=(profile?.role==='super_admin'||profile?.role==='college_admin')?'block':'none'; }
    }
    let query=client.from("quiz_questions").select("*");
    if(category!=='all'){ query=query.eq("category",category); }
    const {data,error}=await query.order("difficulty",{ascending:true});
    if(error||!data||data.length===0){
        document.getElementById('quizBattleContainer').innerHTML=`<div class='empty-box'>No questions available for ${category}.</div>`;
        return;
    }
    displayQuizStart(data);
}

function displayQuizStart(questions){
    currentQuestions=questions;
    const container=document.getElementById('quizBattleContainer');
    const subjects=[...new Set(questions.map(q=>q.subject))];
    container.innerHTML=`
        <div class="profile-card" style="text-align:center;">
            <h2 style="color:#fdcb6e;font-size:24px;">📚 Quiz Battle</h2>
            <p style="color:#888;margin:10px 0;">Test your knowledge and challenge your rivals!</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:20px 0;">
                <div style="background:#0e0e0e;padding:15px;border-radius:12px;"><div style="font-size:28px;font-weight:900;color:#00d2ff;">${questions.length}</div><div style="font-size:12px;color:#888;">Total Questions</div></div>
                <div style="background:#0e0e0e;padding:15px;border-radius:12px;"><div style="font-size:28px;font-weight:900;color:#00b894;">${subjects.length}</div><div style="font-size:12px;color:#888;">Subjects</div></div>
                <div style="background:#0e0e0e;padding:15px;border-radius:12px;"><div style="font-size:28px;font-weight:900;color:#fdcb6e;">${questions.filter(q=>q.difficulty==='easy').length}</div><div style="font-size:12px;color:#888;">Easy</div></div>
                <div style="background:#0e0e0e;padding:15px;border-radius:12px;"><div style="font-size:28px;font-weight:900;color:#e17055;">${questions.filter(q=>q.difficulty==='hard').length}</div><div style="font-size:12px;color:#888;">Hard</div></div>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:15px;">
                <button class="btn-3d-white-glow" onclick="startQuizBattle()" style="width:auto;padding:12px 30px;">⚔️ START BATTLE</button>
                <button class="btn-3d-white-glow" onclick="findQuizOpponent()" style="width:auto;padding:12px 30px;">🎯 FIND OPPONENT</button>
            </div>
        </div>
        <div id="quizOpponentList" style="margin-top:20px;display:none;"></div>
    `;
}

async function findQuizOpponent(){
    const list=document.getElementById('quizOpponentList');
    if(!list) return;
    list.style.display='block';
    list.innerHTML="<div class='empty-box'>Searching for opponents...</div>";
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:profiles}=await client.from("profiles").select("id, full_name, inter_rivalry_id").neq("id",user.id).eq("role","student").limit(10);
    if(!profiles||profiles.length===0){ list.innerHTML="<div class='empty-box'>No opponents found. Invite a friend to play!</div>"; return; }
    list.innerHTML=`<h3 style="color:#888;margin-bottom:10px;">👥 Available Opponents</h3><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;">${profiles.map(p=>`<div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:15px;text-align:center;"><div style="font-size:24px;">👤</div><div style="font-weight:600;margin-top:5px;">${escapeHTML(p.full_name)}</div><div style="font-size:11px;color:#888;">${escapeHTML(p.inter_rivalry_id||'')}</div><button class="btn-3d-xs-white-glow" style="margin-top:8px;width:auto;padding:4px 12px;" onclick="challengeQuizOpponent('${p.id}')">⚔️ CHALLENGE</button></div>`).join('')}</div>`;
}

async function challengeQuizOpponent(opponentId){
    const {data:{user}}=await client.auth.getUser(); if(!user) return alert("Please login first.");
    const {data:challenge,error}=await client.from("challenges").insert({
        challenger_id:user.id, opponent_id:opponentId, subcategory_id:null,
        title:'📚 Quiz Battle', description:`Quiz Battle on ${selectedCategory==='all'?'General':selectedCategory}`,
        rules:{type:'quiz',category:selectedCategory,total_questions:5,time_per_question:30},
        status:'pending', starts_at:new Date().toISOString(), ends_at:new Date(Date.now()+3600000).toISOString()
    }).select("id").single();
    if(error){ alert("Error: "+error.message); return; }
    alert("✅ Quiz challenge sent! Waiting for opponent to accept.");
    loadQuizCategories(selectedCategory);
}

async function startQuizBattle(){
    const {data:{user}}=await client.auth.getUser(); if(!user) return alert("Please login first.");
    const subject=document.getElementById('quizSubjectSelect')?.value||'General';
    const difficulty=document.getElementById('quizDifficultySelect')?.value||'medium';
    const count=parseInt(document.getElementById('quizCountSelect')?.value)||5;
    opponentScore=0; currentQuestionIndex=0; playerScore=0;
    showQuizLoading('🧠 AI is generating '+count+' questions on '+subject+'...');
    const questions=await generateQuizQuestions(subject,subject,count,difficulty);
    if(!questions||questions.length===0){ alert("No questions generated. Please try again!"); closeQuizLoading(); return; }
    currentQuestions=questions; currentQuestionIndex=0; playerScore=0; opponentScore=0;
    closeQuizLoading(); showQuizQuestion();
}

async function generateQuizQuestions(category,subject,count=5,difficulty='medium'){
    try {
        const {data,error}=await client.functions.invoke('generate-quiz',{body:{category,subject,count,difficulty}});
        if(error||!data?.questions){ return await getLocalQuizQuestions(category,count); }
        return data.questions;
    } catch(error){ return await getLocalQuizQuestions(category,count); }
}

async function getLocalQuizQuestions(category,count){
    let query=client.from("quiz_questions").select("*");
    if(category!=='all'&&category!=='General'){ query=query.eq("category",category); }
    const {data}=await query.limit(count*3);
    if(!data||data.length===0){ return getFallbackQuestions(category,count); }
    const shuffled=data.sort(()=>Math.random()-0.5);
    return shuffled.slice(0,count);
}

function getFallbackQuestions(category,count){
    const fallbacks={
        'BCA':[{question:'What is the full form of RAM?',options:['Random Access Memory','Read Access Memory','Run Access Memory','None'],correct_answer:0,difficulty:'easy',points:10}],
        'Coding':[{question:'What is the output of 2 + "2" in JavaScript?',options:['4','"22"','22','Error'],correct_answer:1,difficulty:'medium',points:15}],
        'General':[{question:'What is the speed of light?',options:['3x10⁸ m/s','3x10⁶ m/s','3x10¹⁰ m/s','None'],correct_answer:0,difficulty:'easy',points:10}]
    };
    const questions=fallbacks[category]||fallbacks['General'];
    const shuffled=questions.sort(()=>Math.random()-0.5);
    return shuffled.slice(0,Math.min(count,questions.length));
}

function showQuizLoading(message){
    const modal=document.getElementById('quizModal');
    const content=document.getElementById('quizContent');
    modal.style.display='flex';
    content.innerHTML=`
        <div style="text-align:center;padding:40px 0;">
            <div style="font-size:64px;margin-bottom:20px;">🧠</div>
            <h2 style="color:#00d2ff;">${message}</h2>
            <div style="margin-top:20px;"><div style="width:100%;height:4px;background:#222;border-radius:4px;overflow:hidden;"><div style="width:100%;height:100%;background:linear-gradient(90deg,#00d2ff,#fdcb6e,#00b894);background-size:200%;animation:loadingBar 1.5s infinite;"></div></div></div>
            <p style="color:#888;margin-top:15px;">Please wait while we create your custom quiz...</p>
        </div>
    `;
}

const loadingStyle=document.createElement("style");
loadingStyle.textContent=`@keyframes loadingBar{0%{background-position:-200% 0;}100%{background-position:200% 0;}}`;
document.head.appendChild(loadingStyle);

function closeQuizLoading(){}

function showQuizQuestion(){
    const modal=document.getElementById('quizModal');
    const content=document.getElementById('quizContent');
    if(currentQuestionIndex>=currentQuestions.length){ endQuizBattle(); return; }
    const question=currentQuestions[currentQuestionIndex];
    const total=currentQuestions.length;
    const progress=((currentQuestionIndex)/total)*100;
    content.innerHTML=`
        <div style="margin-bottom:20px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <span style="color:#888;">Question ${currentQuestionIndex+1}/${total}</span>
                <span style="color:#00d2ff;">${escapeHTML(question.subject||'General')}</span>
                <span style="background:${question.difficulty==='easy'?'#00b894':question.difficulty==='medium'?'#fdcb6e':'#e17055'};padding:3px 12px;border-radius:999px;font-size:11px;color:white;">${question.difficulty}</span>
                <span style="color:#fdcb6e;">⭐ ${question.points||10} pts</span>
            </div>
            <div style="width:100%;height:4px;background:#222;border-radius:4px;margin-top:10px;">
                <div style="width:${progress}%;height:100%;background:linear-gradient(90deg,#00d2ff,#fdcb6e);border-radius:4px;transition:width 0.3s;"></div>
            </div>
        </div>
        <h3 style="color:white;font-size:20px;margin-bottom:25px;">${escapeHTML(question.question)}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            ${question.options.map((opt,idx)=>`<button class="btn-3d-sm-white-glow quiz-option" data-index="${idx}" style="width:100%;padding:12px;font-size:14px;text-transform:none;letter-spacing:0;justify-content:flex-start;gap:10px;">${String.fromCharCode(65+idx)}. ${escapeHTML(opt)}</button>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:20px;padding-top:15px;border-top:1px solid #222;">
            <div><span style="color:#888;">Your Score: </span><span style="color:#00d2ff;font-weight:700;">${playerScore}</span></div>
            <div><span style="color:#888;">Opponent: </span><span style="color:#e17055;font-weight:700;">${opponentScore}</span></div>
        </div>
        <div id="quizFeedback" style="margin-top:15px;text-align:center;"></div>
    `;
    modal.style.display='flex';
    document.querySelectorAll('.quiz-option').forEach(btn=>{
        btn.addEventListener('click',function(){
            const selectedIndex=parseInt(this.dataset.index);
            handleQuizAnswer(selectedIndex);
        });
    });
    startQuizTimer();
}

function handleQuizAnswer(selectedIndex){
    const question=currentQuestions[currentQuestionIndex];
    const isCorrect=selectedIndex===question.correct_answer;
    if(isCorrect){ playerScore+=question.points||10; }
    const feedback=document.getElementById('quizFeedback');
    feedback.innerHTML=`<div style="padding:10px;border-radius:8px;background:${isCorrect?'rgba(0,184,148,0.2)':'rgba(225,112,85,0.2)'};border:1px solid ${isCorrect?'#00b894':'#e17055'};"><span style="font-size:20px;">${isCorrect?'✅':'❌'}</span><span style="color:${isCorrect?'#00b894':'#e17055'};font-weight:700;margin-left:10px;">${isCorrect?'Correct! +'+question.points+' points':'Wrong! The correct answer was: '+String.fromCharCode(65+question.correct_answer)+'. '+question.options[question.correct_answer]}</span></div>`;
    document.querySelectorAll('.quiz-option').forEach(btn=>{
        btn.disabled=true;
        btn.style.opacity='0.5';
        if(parseInt(btn.dataset.index)===question.correct_answer){
            btn.style.borderColor='#00b894';
            btn.style.background='rgba(0,184,148,0.2)';
        }
    });
    clearInterval(quizTimer);
    currentQuestionIndex++;
    setTimeout(()=>{
        if(currentQuestionIndex<currentQuestions.length){ showQuizQuestion(); } else { endQuizBattle(); }
    },3000);
}

function startQuizTimer(){
    timeLeft=30;
    clearInterval(quizTimer);
    quizTimer=setInterval(()=>{
        timeLeft--;
        if(timeLeft<=0){ clearInterval(quizTimer); handleQuizAnswer(-1); }
    },1000);
}

function endQuizBattle(){
    const modal=document.getElementById('quizModal');
    const content=document.getElementById('quizContent');
    clearInterval(quizTimer);
    let winnerText='', winnerColor='#fdcb6e';
    if(playerScore>opponentScore){ winnerText='🎉 You Won!'; winnerColor='#00b894'; } else if(playerScore<opponentScore){ winnerText='💪 Opponent Won!'; winnerColor='#e17055'; } else { winnerText='🤝 It\'s a Draw!'; winnerColor='#fdcb6e'; }
    if(currentQuizSession){
        client.from("quiz_sessions").update({
            player1_score:playerScore, player2_score:opponentScore, status:'completed',
            ended_at:new Date().toISOString(),
            winner_id:playerScore>opponentScore?(await client.auth.getUser()).user.id:null
        }).eq("id",currentQuizSession);
    }
    content.innerHTML=`
        <div style="text-align:center;padding:20px 0;">
            <div style="font-size:72px;margin-bottom:20px;">🏆</div>
            <h2 style="color:${winnerColor};font-size:32px;">${winnerText}</h2>
            <div style="display:flex;justify-content:center;gap:40px;margin:30px 0;">
                <div><div style="font-size:36px;font-weight:900;color:#00d2ff;">${playerScore}</div><div style="color:#888;">Your Score</div></div>
                <div><div style="font-size:36px;font-weight:900;color:#e17055;">${opponentScore}</div><div style="color:#888;">Opponent</div></div>
            </div>
            <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
                <button class="btn-3d-white-glow" onclick="closeQuizModal(); loadQuizCategories('${selectedCategory}');" style="width:auto;padding:10px 24px;">🔄 PLAY AGAIN</button>
                <button class="btn-3d-white-glow" onclick="closeQuizModal();" style="width:auto;padding:10px 24px;">🏠 HOME</button>
            </div>
        </div>
    `;
}

function closeQuizModal(){ document.getElementById('quizModal').style.display='none'; clearInterval(quizTimer); }

// ===== QUIZ ADMIN =====
async function addQuizQuestion(){
    const subject=document.getElementById('newQuestionSubject').value.trim();
    const category=document.getElementById('newQuestionCategory').value;
    const question=document.getElementById('newQuestionText').value.trim();
    const optA=document.getElementById('newOptA').value.trim();
    const optB=document.getElementById('newOptB').value.trim();
    const optC=document.getElementById('newOptC').value.trim();
    const optD=document.getElementById('newOptD').value.trim();
    const correct=parseInt(document.getElementById('newCorrectAnswer').value);
    const difficulty=document.getElementById('newDifficulty').value;
    const points=parseInt(document.getElementById('newPoints').value)||10;
    const msg=document.getElementById('questionAdminMessage');
    if(!subject||!question||!optA||!optB||!optC||!optD){
        msg.textContent="⚠️ Please fill in all fields!"; msg.style.color="#ff6b6b"; return;
    }
    msg.textContent="Adding question..."; msg.style.color="#888";
    const {data:{user}}=await client.auth.getUser();
    if(!user){ msg.textContent="Please login first."; msg.style.color="#ff6b6b"; return; }
    const {data:profile}=await client.from("profiles").select("role").eq("id",user.id).single();
    if(profile?.role!=='super_admin'&&profile?.role!=='college_admin'){
        msg.textContent="⚠️ Only admins can add questions!"; msg.style.color="#ff6b6b"; return;
    }
    const {error}=await client.from("quiz_questions").insert({
        subject,category,question,options:[optA,optB,optC,optD],
        correct_answer:correct,difficulty,points
    });
    if(error){ msg.textContent="Error: "+error.message; msg.style.color="#ff6b6b"; return; }
    msg.textContent="✅ Question added successfully! 🎉"; msg.style.color="#00b894";
    document.getElementById('newQuestionSubject').value='';
    document.getElementById('newQuestionText').value='';
    document.getElementById('newOptA').value='';
    document.getElementById('newOptB').value='';
    document.getElementById('newOptC').value='';
    document.getElementById('newOptD').value='';
    document.getElementById('newPoints').value='10';
    setTimeout(()=>{ msg.textContent=''; },3000);
}

async function viewAllQuestions(){
    const {data:questions,error}=await client.from("quiz_questions").select("*").order("category",{ascending:true}).order("subject",{ascending:true});
    if(error||!questions||questions.length===0){ alert("No questions found."); return; }
    const grouped={};
    questions.forEach(q=>{
        if(!grouped[q.category]) grouped[q.category]=[];
        grouped[q.category].push(q);
    });
    let html=`<div style="max-height:400px;overflow-y:auto;padding:10px;">`;
    Object.keys(grouped).forEach(cat=>{
        html+=`<h3 style="color:#fdcb6e;margin-top:15px;">📚 ${cat} (${grouped[cat].length} questions)</h3>`;
        html+=grouped[cat].map(q=>`
            <div style="background:#0e0e0e;border:1px solid #282828;border-radius:8px;padding:10px;margin:5px 0;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:5px;">
                    <div><strong>${escapeHTML(q.question)}</strong><br><span style="font-size:11px;color:#888;">${escapeHTML(q.subject)} • ${q.difficulty} • ⭐${q.points}</span></div>
                    <button class="btn-3d-xs-white-glow" style="width:auto;padding:3px 10px;font-size:9px;" onclick="deleteQuestion('${q.id}')">🗑️</button>
                </div>
            </div>
        `).join('');
    });
    html+=`</div>`;
    const modal=document.createElement('div');
    modal.style.cssText=`position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;padding:20px;backdrop-filter:blur(10px);`;
    modal.innerHTML=`<div style="background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:30px;max-width:600px;width:100%;max-height:90vh;overflow-y:auto;"><h2 style="color:white;margin-bottom:15px;">📋 All Questions</h2>${html}<button class="btn-3d-white-glow" style="margin-top:15px;" onclick="this.parentElement.parentElement.remove()">❌ CLOSE</button></div>`;
    document.body.appendChild(modal);
}

async function deleteQuestion(questionId){
    if(!confirm("Delete this question?")) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:profile}=await client.from("profiles").select("role").eq("id",user.id).single();
    if(profile?.role!=='super_admin'&&profile?.role!=='college_admin'){ alert("Only admins can delete questions!"); return; }
    const {error}=await client.from("quiz_questions").delete().eq("id",questionId);
    if(error){ alert("Error: "+error.message); return; }
    alert("✅ Question deleted!"); viewAllQuestions();
}

async function loadQuizHistory(){
    const list=document.getElementById('quizHistoryList');
    if(!list) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:sessions}=await client.from("quiz_sessions").select("*, profiles!quiz_sessions_player1_id_fkey(full_name, inter_rivalry_id)").or(`player1_id.eq.${user.id},player2_id.eq.${user.id}`).eq("status","completed").order("ended_at",{ascending:false}).limit(10);
    if(!sessions||sessions.length===0){ list.innerHTML="<div class='empty-box'>No quiz history yet. Start a battle!</div>"; return; }
    list.innerHTML=sessions.map(s=>{
        const isPlayer1=s.player1_id===user.id;
        const opponent=isPlayer1?s.profiles:s.profiles;
        const myScore=isPlayer1?s.player1_score:s.player2_score;
        const oppScore=isPlayer1?s.player2_score:s.player1_score;
        const won=myScore>oppScore;
        return `<div style="background:#121212;border:1px solid #292929;border-radius:12px;padding:15px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
            <div><div style="font-weight:600;">${won?'✅':'❌'} vs ${escapeHTML(opponent?.full_name||'Unknown')}</div><div style="font-size:12px;color:#888;">${formatDate(s.ended_at)}</div></div>
            <div style="display:flex;gap:20px;"><div><span style="color:#00d2ff;">${myScore}</span> - <span style="color:#e17055;">${oppScore}</span></div><span style="color:${won?'#00b894':'#e17055'};font-weight:700;">${won?'WIN':'LOSS'}</span></div>
        </div>`;
    }).join('');
}

// ===== NOTIFICATION PERMISSION =====
async function requestNotificationPermission(){
    if(!('Notification' in window)){ console.log('This browser does not support notifications'); return false; }
    const permission=await Notification.requestPermission();
    return permission==='granted';
}

async function registerDevice(){
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    if(!('serviceWorker' in navigator)){ console.log('Service workers not supported'); return; }
    try {
        const registration=await navigator.serviceWorker.register('/sw.js');
        console.log('Service Worker registered');
    } catch(error){ console.error('Push registration error:',error); }
}

// ===== GRADEBOOK =====
function switchGradeTab(tab){
    currentGradeTab=tab;
    document.querySelectorAll('.grade-tab-btn').forEach(btn=>{
        btn.style.opacity='0.5'; btn.style.transform='scale(0.95)';
    });
    document.getElementById('gradeSubjectsTab').style.display='none';
    document.getElementById('gradeGradesTab').style.display='none';
    document.getElementById('gradeRankingsTab').style.display='none';
    if(tab==='subjects'){
        document.getElementById('gradeSubjectsTab').style.display='block';
        document.getElementById('gradeTabSubjects').style.opacity='1';
        document.getElementById('gradeTabSubjects').style.transform='scale(1)';
        loadMySubjects();
    } else if(tab==='grades'){
        document.getElementById('gradeGradesTab').style.display='block';
        document.getElementById('gradeTabGrades').style.opacity='1';
        document.getElementById('gradeTabGrades').style.transform='scale(1)';
        loadMyGrades();
        loadSubjectDropdown();
    } else if(tab==='rankings'){
        document.getElementById('gradeRankingsTab').style.display='block';
        document.getElementById('gradeTabRankings').style.opacity='1';
        document.getElementById('gradeTabRankings').style.transform='scale(1)';
        loadGradeRankings('all');
    }
}

async function addSubject(){
    const name=document.getElementById('newSubjectName').value.trim();
    const category=document.getElementById('newSubjectCategory').value;
    const semester=parseInt(document.getElementById('newSubjectSemester').value);
    const msg=document.getElementById('subjectMessage');
    if(!name){ msg.textContent='⚠️ Please enter a subject name.'; msg.style.color='#ff6b6b'; return; }
    const {data:{user}}=await client.auth.getUser();
    if(!user){ msg.textContent='Please login first.'; msg.style.color='#ff6b6b'; return; }
    const {data:existing}=await client.from('student_subjects').select('id').eq('student_id',user.id).eq('subject_name',name).maybeSingle();
    if(existing){ msg.textContent='⚠️ You already have this subject!'; msg.style.color='#ff6b6b'; return; }
    msg.textContent='Adding subject...'; msg.style.color='#888';
    const {error}=await client.from('student_subjects').insert({student_id:user.id,subject_name:name,category,semester});
    if(error){ msg.textContent='Error: '+error.message; msg.style.color='#ff6b6b'; return; }
    msg.textContent='✅ Subject added successfully! 🎉'; msg.style.color='#00b894';
    document.getElementById('newSubjectName').value='';
    setTimeout(()=>{ msg.textContent=''; loadMySubjects(); loadSubjectDropdown(); },1500);
}

async function loadMySubjects(){
    const list=document.getElementById('mySubjectsList');
    if(!list) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:subjects,error}=await client.from('student_subjects').select('*').eq('student_id',user.id).eq('is_active',true).order('semester',{ascending:true});
    if(error||!subjects||subjects.length===0){
        list.innerHTML=`<div class='empty-box'>📚 No subjects added yet.<br>Add your subjects above to start tracking your grades!</div>`;
        return;
    }
    mySubjects=subjects;
    const totalSubjects=subjects.length;
    const semesters=[...new Set(subjects.map(s=>s.semester))];
    const statsDiv=document.getElementById('gradeStats');
    if(statsDiv){
        statsDiv.innerHTML=`<div class="rival-stat"><div class="num">${totalSubjects}</div><div class="lbl">Subjects</div></div><div class="rival-stat"><div class="num">${semesters.length}</div><div class="lbl">Semesters</div></div><div class="rival-stat"><div class="num">${subjects.filter(s=>s.category==='Custom').length}</div><div class="lbl">Custom</div></div><div class="rival-stat"><div class="num">-</div><div class="lbl">Avg Grade</div></div>`;
    }
    list.innerHTML=subjects.map(s=>`
        <div style="background:#0e0e0e;border:1px solid #282828;border-radius:10px;padding:15px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
            <div><div style="font-weight:600;font-size:16px;">📚 ${escapeHTML(s.subject_name)}</div><div style="font-size:12px;color:#888;">${escapeHTML(s.category)} • Semester ${s.semester}</div></div>
            <div style="display:flex;gap:8px;"><button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:10px;" onclick="deleteSubject('${s.id}')">🗑️</button></div>
        </div>
    `).join('');
}

async function deleteSubject(subjectId){
    if(!confirm('Delete this subject and all its grades?')) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {error}=await client.from('student_subjects').update({is_active:false}).eq('id',subjectId).eq('student_id',user.id);
    if(error){ alert('Error: '+error.message); return; }
    alert('✅ Subject deleted!'); loadMySubjects(); loadSubjectDropdown();
}

async function loadSubjectDropdown(){
    const select=document.getElementById('gradeSubjectSelect');
    if(!select) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:subjects}=await client.from('student_subjects').select('id, subject_name').eq('student_id',user.id).eq('is_active',true).order('subject_name');
    if(!subjects||subjects.length===0){ select.innerHTML='<option value="">No subjects added. Add a subject first!</option>'; return; }
    select.innerHTML='<option value="">Select a subject...</option>';
    subjects.forEach(s=>{
        const option=document.createElement('option');
        option.value=s.id; option.textContent=s.subject_name;
        select.appendChild(option);
    });
}

async function addGrade(){
    const subjectId=document.getElementById('gradeSubjectSelect').value;
    const examName=document.getElementById('gradeExamName').value.trim();
    const examType=document.getElementById('gradeExamType').value;
    const marksObtained=parseInt(document.getElementById('gradeMarksObtained').value);
    const totalMarks=parseInt(document.getElementById('gradeTotalMarks').value)||100;
    const msg=document.getElementById('gradeMessage');
    if(!subjectId){ msg.textContent='⚠️ Please select a subject.'; msg.style.color='#ff6b6b'; return; }
    if(!examName){ msg.textContent='⚠️ Please enter an exam name.'; msg.style.color='#ff6b6b'; return; }
    if(isNaN(marksObtained)){ msg.textContent='⚠️ Please enter valid marks.'; msg.style.color='#ff6b6b'; return; }
    if(marksObtained>totalMarks){ msg.textContent='⚠️ Marks cannot exceed total marks.'; msg.style.color='#ff6b6b'; return; }
    const {data:{user}}=await client.auth.getUser(); if(!user){ msg.textContent='Please login first.'; msg.style.color='#ff6b6b'; return; }
    msg.textContent='Adding grade...'; msg.style.color='#888';
    const {error}=await client.from('student_grades').insert({student_id:user.id,subject_id:subjectId,exam_name:examName,exam_type:examType,marks_obtained:marksObtained,total_marks:totalMarks,is_verified:true});
    if(error){ msg.textContent='Error: '+error.message; msg.style.color='#ff6b6b'; return; }
    msg.textContent='✅ Grade added successfully! 🎉'; msg.style.color='#00b894';
    document.getElementById('gradeExamName').value='';
    document.getElementById('gradeMarksObtained').value='';
    document.getElementById('gradeTotalMarks').value='100';
    setTimeout(()=>{ msg.textContent=''; loadMyGrades(); },1500);
}

async function loadMyGrades(){
    const list=document.getElementById('myGradesList');
    if(!list) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {data:grades,error}=await client.from('student_grades').select('*, student_subjects!subject_id(subject_name, category, semester)').eq('student_id',user.id).order('uploaded_at',{ascending:false});
    if(error||!grades||grades.length===0){
        list.innerHTML=`<div class='empty-box'>📝 No grades added yet.<br>Add your grades above to track your performance!</div>`;
        return;
    }
    const avgPercentage=grades.reduce((sum,g)=>sum+g.percentage,0)/grades.length;
    const totalExams=grades.length;
    const subjects=[...new Set(grades.map(g=>g.student_subjects?.subject_name))];
    const statsDiv=document.getElementById('gradeStats');
    if(statsDiv){
        statsDiv.innerHTML=`<div class="rival-stat"><div class="num">${subjects.length}</div><div class="lbl">Subjects</div></div><div class="rival-stat"><div class="num">${Math.round(avgPercentage)}%</div><div class="lbl">Average</div></div><div class="rival-stat"><div class="num">${totalExams}</div><div class="lbl">Exams</div></div><div class="rival-stat"><div class="num">-</div><div class="lbl">Rank</div></div>`;
    }
    list.innerHTML=grades.map(g=>{
        const grade=calculateGrade(g.percentage);
        const gradeColors={'S':'#ffd700','A':'#00b894','B':'#00d2ff','C':'#fdcb6e','D':'#e17055','E':'#636e72','F':'#ff6b6b'};
        const gradeColor=gradeColors[grade]||'#888';
        return `
            <div style="background:#0e0e0e;border:1px solid #282828;border-radius:10px;padding:15px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div><div style="font-weight:600;">📚 ${escapeHTML(g.student_subjects?.subject_name||'Unknown')}</div><div style="font-size:12px;color:#888;">${escapeHTML(g.exam_name)} • ${escapeHTML(g.exam_type)}</div><div style="font-size:11px;color:#888;">${formatDate(g.uploaded_at)}</div></div>
                <div style="display:flex;align-items:center;gap:15px;">
                    <div style="text-align:center;"><span style="font-size:20px;font-weight:700;color:${gradeColor};">${grade}</span><div style="font-size:10px;color:#888;">Grade</div></div>
                    <div style="text-align:center;"><span style="font-size:20px;font-weight:700;color:#00d2ff;">${g.marks_obtained}/${g.total_marks}</span><div style="font-size:10px;color:#888;">Score</div></div>
                    <div style="text-align:center;"><span style="font-size:20px;font-weight:700;color:#fdcb6e;">${Math.round(g.percentage)}%</span><div style="font-size:10px;color:#888;">Percentage</div></div>
                    <button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:9px;" onclick="deleteGrade('${g.id}')">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

async function deleteGrade(gradeId){
    if(!confirm('Delete this grade?')) return;
    const {data:{user}}=await client.auth.getUser(); if(!user) return;
    const {error}=await client.from('student_grades').delete().eq('id',gradeId).eq('student_id',user.id);
    if(error){ alert('Error: '+error.message); return; }
    alert('✅ Grade deleted!'); loadMyGrades();
}

function calculateGrade(percentage){
    if(percentage>=90) return 'S';
    if(percentage>=80) return 'A';
    if(percentage>=70) return 'B';
    if(percentage>=60) return 'C';
    if(percentage>=50) return 'D';
    if(percentage>=40) return 'E';
    return 'F';
}

async function loadGradeRankings(category){
    const list=document.getElementById('gradeRankingsList');
    if(!list) return;
    list.innerHTML="<div class='empty-box'>Loading rankings...</div>";
    let query=client.from('grade_ranks').select('*, profiles!grade_ranks_student_id_fkey(full_name, inter_rivalry_id)').order('overall_percentage',{ascending:false}).limit(50);
    if(category!=='all'){ query=query.eq('category',category); }
    const {data:ranks,error}=await query;
    if(error||!ranks||ranks.length===0){
        list.innerHTML="<div class='empty-box'>No rankings available yet. Start adding subjects and grades!</div>";
        return;
    }
    const {data:{user}}=await client.auth.getUser();
    let html=`<div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:20px;"><h2 style="color:#fdcb6e;margin-bottom:15px;">🏆 Rankings</h2><div style="display:flex;flex-direction:column;gap:8px;">`;
    ranks.forEach((rank,index)=>{
        const isCurrentUser=rank.student_id===user?.id;
        const medal=index===0?'🥇':index===1?'🥈':index===2?'🥉':`#${index+1}`;
        const percentage=rank.overall_percentage||0;
        const grade=calculateGrade(percentage);
        const gradeColors={'S':'#ffd700','A':'#00b894','B':'#00d2ff','C':'#fdcb6e','D':'#e17055','E':'#636e72','F':'#ff6b6b'};
        const gradeColor=gradeColors[grade]||'#888';
        html+=`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:${isCurrentUser?'#1a1a2e':'#0e0e0e'};border-radius:10px;border:${isCurrentUser?'2px solid #00d2ff':'1px solid #282828'};">
                <div style="display:flex;align-items:center;gap:15px;flex:1;">
                    <span style="font-weight:700;color:#888;min-width:40px;">${medal}</span>
                    <div><span style="font-weight:600;">${escapeHTML(rank.profiles?.full_name||'Unknown')}</span>${isCurrentUser?'<span style="font-size:11px;color:#00d2ff;margin-left:8px;">(YOU)</span>':''}<div style="font-size:11px;color:#888;">${escapeHTML(rank.subject_name)} • ${escapeHTML(rank.category)}</div></div>
                </div>
                <div style="display:flex;align-items:center;gap:20px;">
                    <div style="text-align:right;"><span style="font-size:18px;font-weight:700;color:${gradeColor};">${grade}</span><div style="font-size:11px;color:#888;">Grade</div></div>
                    <div style="text-align:right;"><span style="font-size:18px;font-weight:700;color:#00d2ff;">${percentage}%</span><div style="font-size:11px;color:#888;">Percentage</div></div>
                    <div style="text-align:right;"><span style="font-size:14px;font-weight:600;color:#fdcb6e;">${rank.total_marks_obtained||0}</span><div style="font-size:11px;color:#888;">Total</div></div>
                </div>
            </div>
        `;
    });
    html+=`</div></div>`;
    list.innerHTML=html;
}

// ===== ADMIN FUNCTIONS =====
async function loadAdminDashboard(){
    showOnlyAdmin();
    await loadAdminStats();
    await loadAdminColleges();
}

async function loadAdminStats(){
    const {count:colleges}=await client.from("colleges").select("id",{count:"exact",head:true});
    document.getElementById("collegeCount").textContent=colleges||0;
    const {count:requests}=await client.from("college_join_requests").select("id",{count:"exact",head:true}).eq("status","pending");
    document.getElementById("requestCount").textContent=requests||0;
    const {count:admins}=await client.from("college_admins").select("id",{count:"exact",head:true});
    document.getElementById("adminCount").textContent=admins||0;
}

async function loadAdminColleges(){
    const {data,error}=await client.from("colleges").select("id,college_name,college_code,city,state").order("college_name",{ascending:true});
    const list=document.getElementById("adminCollegeList");
    list.innerHTML="";
    if(error||!data||data.length===0){ list.innerHTML="<div class='empty-box'>No colleges added yet.</div>"; return; }
    data.forEach(college=>{
        const card=document.createElement("div");
        card.className="college-card";
        card.innerHTML=`<h3>${escapeHTML(college.college_name)}</h3><div class="college-code">Code: ${escapeHTML(college.college_code)}</div><div class="college-location">${escapeHTML(college.city||"")}${college.state?", "+escapeHTML(college.state):""}</div><button class="btn-3d-sm-white-glow" onclick="viewCollege('${college.id}')">📋 MANAGE</button>`;
        list.appendChild(card);
    });
}

async function addCollege(){
    const name=document.getElementById("collegeName").value.trim();
    const code=document.getElementById("collegeCode").value.trim().toUpperCase();
    const city=document.getElementById("collegeCity").value.trim();
    const state=document.getElementById("collegeState").value.trim();
    const message=document.getElementById("adminMessage");
    if(!name||!code){ message.textContent="Name and code required."; return; }
    message.textContent="Adding college...";
    const {error}=await client.from("colleges").insert({college_name:name,college_code:code,city:city||null,state:state||null,country:"India"});
    if(error){ message.textContent="Error: "+error.message; return; }
    message.textContent="✅ College added!";
    document.getElementById("collegeName").value=""; document.getElementById("collegeCode").value=""; document.getElementById("collegeCity").value=""; document.getElementById("collegeState").value="";
    await loadAdminStats(); await loadAdminColleges();
}

async function viewCollege(collegeId){
    selectedCollegeId=collegeId;
    const {data:college,error}=await client.from("colleges").select("id,college_name,college_code,city,state").eq("id",collegeId).single();
    if(error){ alert("Unable to load college."); return; }
    document.getElementById("manageCollegeName").textContent=college.college_name;
    document.getElementById("manageCollegeCode").textContent=college.college_code||"-";
    document.getElementById("manageCollegeCity").textContent=college.city||"-";
    document.getElementById("manageCollegeState").textContent=college.state||"-";
    document.getElementById("manageCollegeLocation").textContent=(college.city||"")+(college.state?", "+college.state:"");
    document.getElementById("editCollegeName").value=college.college_name||"";
    document.getElementById("editCollegeCode").value=college.college_code||"";
    document.getElementById("editCollegeCity").value=college.city||"";
    document.getElementById("editCollegeState").value=college.state||"";
    await loadCollegeManagementCounts(collegeId);
    showOnlyCollegeManagement();
}

async function loadCollegeManagementCounts(collegeId){
    if(!collegeId) return;
    const {count:admins}=await client.from("college_admins").select("id",{count:"exact",head:true}).eq("college_id",collegeId);
    document.getElementById("manageAdminCount").textContent=admins||0;
    const {count:students}=await client.from("college_memberships").select("id",{count:"exact",head:true}).eq("college_id",collegeId).eq("is_active",true);
    document.getElementById("manageStudentCount").textContent=students||0;
    const {count:requests}=await client.from("college_join_requests").select("id",{count:"exact",head:true}).eq("college_id",collegeId).eq("status","pending");
    document.getElementById("manageRequestCount").textContent=requests||0;
}

async function saveCollegeChanges(){
    if(!selectedCollegeId) return;
    const name=document.getElementById("editCollegeName").value.trim();
    const code=document.getElementById("editCollegeCode").value.trim().toUpperCase();
    const city=document.getElementById("editCollegeCity").value.trim();
    const state=document.getElementById("editCollegeState").value.trim();
    const message=document.getElementById("editMessage");
    if(!name||!code){ message.textContent="Name and code required."; return; }
    message.textContent="Saving...";
    const {error}=await client.from("colleges").update({college_name:name,college_code:code,city:city||null,state:state||null}).eq("id",selectedCollegeId);
    if(error){ message.textContent="Error: "+error.message; return; }
    message.textContent="✅ College updated!";
    document.getElementById("manageCollegeName").textContent=name;
    document.getElementById("manageCollegeCode").textContent=code;
    document.getElementById("manageCollegeCity").textContent=city||"-";
    document.getElementById("manageCollegeState").textContent=state||"-";
}

async function openAdmins(){
    if(!selectedCollegeId) return;
    const {data:college}=await client.from("colleges").select("college_name").eq("id",selectedCollegeId).single();
    document.getElementById("adminsCollegeName").textContent=college?college.college_name:"College";
    await loadAdmins();
    showOnlyAdmins();
}

async function loadAdmins(){
    const {data,error}=await client.from("college_admins").select(`id,user_id,created_at,profiles!college_admins_user_id_fkey(full_name,inter_rivalry_id)`).eq("college_id",selectedCollegeId).order("created_at",{ascending:false});
    const list=document.getElementById("adminsList");
    list.innerHTML="";
    if(error||!data||data.length===0){ list.innerHTML="<div class='empty-box'>No admins assigned.</div>"; return; }
    data.forEach(admin=>{
        const profile=admin.profiles;
        const card=document.createElement("div");
        card.className="admin-card";
        card.innerHTML=`<h3>👤 ${escapeHTML(profile?.full_name||"Unknown")}</h3><div class="admin-info">ID: ${escapeHTML(profile?.inter_rivalry_id||"Unknown")}<br>User ID: ${escapeHTML(admin.user_id)}</div><br><button class="btn-3d-sm-white-glow-danger" onclick="removeCollegeAdmin('${admin.id}')">🗑️ REMOVE ADMIN</button>`;
        list.appendChild(card);
    });
}

async function addCollegeAdmin(){
    const userId=document.getElementById("adminUserId").value.trim();
    const message=document.getElementById("adminManageMessage");
    if(!userId){ message.textContent="Enter user ID."; return; }
    message.textContent="Checking user...";
    const {data:profile}=await client.from("profiles").select("id,full_name,role").eq("id",userId).single();
    if(!profile){ message.textContent="User not found."; return; }
    await client.from("profiles").update({role:"college_admin"}).eq("id",userId);
    const {error}=await client.from("college_admins").insert({college_id:selectedCollegeId,user_id:userId});
    if(error){ message.textContent="Error: "+error.message; return; }
    message.textContent="✅ Admin added!";
    document.getElementById("adminUserId").value="";
    await loadAdmins(); await loadCollegeManagementCounts(selectedCollegeId);
}

async function removeCollegeAdmin(adminId){
    if(!confirm("Remove this admin?")) return;
    const {data:admin}=await client.from("college_admins").select("user_id").eq("id",adminId).single();
    if(!admin) return;
    await client.from("college_admins").delete().eq("id",adminId);
    const {count}=await client.from("college_admins").select("id",{count:"exact",head:true}).eq("user_id",admin.user_id);
    if(!count||count===0){ await client.from("profiles").update({role:"student"}).eq("id",admin.user_id); }
    await loadAdmins(); await loadCollegeManagementCounts(selectedCollegeId);
}

async function openStudents(){
    const {data:college}=await client.from("colleges").select("college_name").eq("id",selectedCollegeId).single();
    document.getElementById("studentsCollegeName").textContent=college?college.college_name:"College";
    await loadStudents();
    showOnlyStudents();
}

async function loadStudents(){
    const display=document.getElementById("studentsDisplay");
    if(!display) return;
    display.innerHTML="<div class='empty-box'>Loading students...</div>";
    const {data,error}=await client.from("college_memberships").select(`id,user_id,student_number,department,course,year_of_study,specialization,joined_at,profiles!college_memberships_user_id_fkey(full_name,inter_rivalry_id)`).eq("college_id",selectedCollegeId).eq("is_active",true).order("year_of_study",{ascending:true});
    if(error||!data||data.length===0){
        display.innerHTML="<div class='empty-box'>No students in this college.</div>";
        return;
    }
    allStudentsData=data;
    displayStudentsByCategory('all');
}

function displayStudentsByCategory(category){
    const display=document.getElementById("studentsDisplay");
    const data=allStudentsData||[];
    if(!data.length){ display.innerHTML="<div class='empty-box'>No students found.</div>"; return; }
    let filtered=data;
    if(category!=='all'){ filtered=data.filter(s=>s.course===category); }
    if(!filtered.length){ display.innerHTML=`<div class='empty-box'>No students found in ${category} category.</div>`; return; }
    const grouped={};
    filtered.forEach(student=>{
        const course=student.course||'Unknown';
        const year=student.year_of_study||0;
        const yearLabel=year===1?'1st Year':year===2?'2nd Year':year===3?'3rd Year':`${year}th Year`;
        if(!grouped[course]) grouped[course]={};
        if(!grouped[course][yearLabel]) grouped[course][yearLabel]=[];
        grouped[course][yearLabel].push(student);
    });
    let html='';
    const courseOrder=['BCA','BBA','B.COM'];
    const sortedCourses=Object.keys(grouped).sort((a,b)=>{
        const indexA=courseOrder.indexOf(a);
        const indexB=courseOrder.indexOf(b);
        if(indexA===-1&&indexB===-1) return a.localeCompare(b);
        if(indexA===-1) return 1;
        if(indexB===-1) return -1;
        return indexA-indexB;
    });
    sortedCourses.forEach(course=>{
        const years=grouped[course];
        const yearKeys=Object.keys(years).sort((a,b)=>{ const numA=parseInt(a); const numB=parseInt(b); return numA-numB; });
        let courseColor='#6c5ce7';
        if(course==='BCA') courseColor='#6c5ce7';
        else if(course==='BBA') courseColor='#00b894';
        else if(course==='B.COM') courseColor='#fdcb6e';
        html+=`<div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:20px;margin-bottom:16px;">
            <h2 style="color:${courseColor};margin-bottom:15px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">${course==='BCA'?'💻':course==='BBA'?'📊':'💰'}</span>
                ${escapeHTML(course)}
                <span style="font-size:14px;color:#888;font-weight:400;">(${filtered.filter(s=>s.course===course).length} students)</span>
            </h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:15px;">`;
        yearKeys.forEach(year=>{
            const students=years[year];
            html+=`<div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="color:#00d2ff;font-size:16px;">📅 ${escapeHTML(year)}</h3>
                    <span style="background:#1a1a1a;padding:4px 12px;border-radius:999px;font-size:12px;color:#888;">${students.length} students</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">`;
            students.forEach(student=>{
                const profile=student.profiles;
                const name=profile?.full_name||'Unknown';
                const rivalryId=profile?.inter_rivalry_id||'Not assigned';
                const spec=student.specialization||'';
                html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0a0a0a;border-radius:8px;border-left:3px solid ${courseColor};">
                    <div><span style="font-weight:600;">👤 ${escapeHTML(name)}</span>
                    <br><span style="font-size:11px;color:#666;">ID: ${escapeHTML(rivalyId)}</span>
                    ${spec?`<br><span style="font-size:11px;color:#888;">🎯 ${escapeHTML(spec)}</span>`:''}</div>
                    <button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:10px;" onclick="viewProfile('${student.user_id}')">VIEW</button>
                </div>`;
            });
            html+=`</div></div>`;
        });
        html+=`</div></div>`;
    });
    display.innerHTML=html;
    document.querySelectorAll('.filter-btn').forEach(btn=>{
        btn.style.opacity='0.5';
        btn.style.transform='scale(0.95)';
    });
    const activeBtn=document.getElementById(`filter${category==='all'?'All':category}`);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
}

function filterStudents(category){
    document.querySelectorAll('.filter-btn').forEach(btn=>{
        btn.style.opacity='0.5';
        btn.style.transform='scale(0.95)';
    });
    const btnId=category==='all'?'filterAll':`filter${category}`;
    const activeBtn=document.getElementById(btnId);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
    displayStudentsByCategory(category);
}

async function openRequests(){
    if(!selectedCollegeId){ alert("No college selected."); return; }
    const {data:college}=await client.from("colleges").select("college_name").eq("id",selectedCollegeId).single();
    document.getElementById("requestsCollegeName").textContent=college?college.college_name:"College";
    await loadRequests();
    showOnlyRequests();
}

async function loadRequests(){
    const list=document.getElementById("requestsList");
    if(!list) return;
    list.innerHTML="<div class='empty-box'>Loading requests...</div>";
    if(!selectedCollegeId){ list.innerHTML="<div class='empty-box'>No college selected.</div>"; return; }
    try {
        const {data,error}=await client.from("college_join_requests")
            .select(`id,student_id,course,year_of_study,department,specialization,status,created_at,profiles!college_join_requests_student_id_fkey(full_name,inter_rivalry_id)`)
            .eq("college_id",selectedCollegeId).eq("status","pending").order("created_at",{ascending:true});
        if(error){ list.innerHTML=`<div class='empty-box'>Error: ${escapeHTML(error.message)}</div>`; return; }
        const validRequests=(data||[]).filter(r=>r.profiles!==null);
        if(!validRequests||validRequests.length===0){ list.innerHTML="<div class='empty-box'>🎉 No pending join requests.</div>"; return; }
        list.innerHTML="";
        for(const request of validRequests){
            const profile=request.profiles;
            const card=document.createElement("div"); card.className="request-card";
            card.innerHTML=`
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
                    <div>
                        <h3>📩 ${escapeHTML(profile?.full_name||"Unknown")}</h3>
                        <div class="request-info"><strong>INTER RIVALRY ID:</strong> ${escapeHTML(profile?.inter_rivalry_id||"Not assigned")}
                        <br><strong>Course:</strong> ${escapeHTML(request.course||"-")}
                        <br><strong>Year:</strong> ${escapeHTML(request.year_of_study||"-")}
                        <br><strong>Department:</strong> ${escapeHTML(request.department||"-")}
                        <br><strong>Specialization:</strong> ${escapeHTML(request.specialization||"-")}
                        <br><small style="color:#666;display:inline-block;margin-top:5px;">Requested: ${formatDate(request.created_at)}</small></div>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button class="btn-3d-sm-white-glow" onclick="reviewRequest('${request.id}', true)">✅ APPROVE</button>
                        <button class="btn-3d-sm-white-glow-danger" onclick="reviewRequest('${request.id}', false)">❌ REJECT</button>
                    </div>
                </div>
            `;
            list.appendChild(card);
        }
    } catch(error){ list.innerHTML=`<div class='empty-box'>Error: ${escapeHTML(error.message)}</div>`; }
}

async function reviewRequest(requestId, approve){
    const action=approve?"APPROVE":"REJECT";
    if(!confirm(`Are you sure you want to ${action} this request?`)) return;
    try {
        const {data:request,error:fetchError}=await client.from("college_join_requests")
            .select(`id, student_id, college_id, course, year_of_study, specialization, department`)
            .eq("id",requestId).single();
        if(fetchError||!request){ alert("Request not found."); return; }
        if(approve){
            const {data:college}=await client.from("colleges").select("college_code").eq("id",request.college_id).single();
            const collegeCode=college?.college_code||'XXXX';
            const randomNum=String(Math.floor(1000+Math.random()*9000));
            const rivalryId=`IR-${collegeCode}-${randomNum}`;
            await client.from("college_join_requests").update({status:"approved",reviewed_at:new Date().toISOString()}).eq("id",requestId);
            const {data:existing}=await client.from("college_memberships").select("id").eq("user_id",request.student_id).eq("college_id",request.college_id).eq("is_active",true).maybeSingle();
            if(!existing){
                await client.from("college_memberships").insert({user_id:request.student_id,college_id:request.college_id,course:request.course,year_of_study:request.year_of_study,specialization:request.specialization,department:request.department,is_active:true,joined_at:new Date().toISOString()});
            }
            await client.from("profiles").update({inter_rivalry_id:rivalryId,college_joined:true}).eq("id",request.student_id);
            alert(`✅ Student approved successfully!\n🎯 INTER RIVALRY ID: ${rivalyId}`);
        } else {
            await client.from("college_join_requests").update({status:"rejected",reviewed_at:new Date().toISOString()}).eq("id",requestId);
            alert("❌ Request rejected.");
        }
        await loadRequests(); await loadCollegeManagementCounts(selectedCollegeId);
    } catch(error){ alert("Error: "+error.message); }
}

async function loadCollegeAdminDashboard(user,profile){
    const {data:admin,error}=await client.from("college_admins").select("college_id,colleges(college_name,college_code,city,state)").eq("user_id",user.id).maybeSingle();
    if(error||!admin){ alert("No college assigned."); showAuth(); return; }
    showOnlyAdmin();
    document.querySelector("#adminDashboard .admin-header h1").textContent="🏫 "+(admin.colleges?admin.colleges.college_name:"College Admin");
    document.querySelector("#adminDashboard .admin-header p").textContent="College Admin Panel";
}

// ===== TEAM MANAGEMENT =====
async function loadMyTeams(){
    const list=document.getElementById("myTeamsList");
    if(!list) return;
    list.innerHTML="<div class='empty-box'>Loading your teams...</div>";
    const {data:{user}}=await client.auth.getUser();
    if(!user){ list.innerHTML="<div class='empty-box'>Please login first.</div>"; return; }
    const {data:memberships,error}=await client.from("team_members").select(`team_id,role,teams(id,name,college_id,captain_id,created_at,profiles!teams_captain_id_fkey(full_name,inter_rivalry_id))`).eq("user_id",user.id);
    if(error||!memberships||memberships.length===0){ list.innerHTML="<div class='empty-box'>You haven't joined any team yet.<br>Create one or wait for an invite!</div>"; return; }
    list.innerHTML="";
    for(const m of memberships){
        const team=m.teams;
        if(!team) continue;
        const isCaptain=team.captain_id===user.id;
        const {count}=await client.from("team_members").select("id",{count:"exact",head:true}).eq("team_id",team.id);
        const card=document.createElement("div");
        card.className="team-card";
        card.innerHTML=`<h3>👥 ${escapeHTML(team.name)} ${isCaptain?'👑':''}</h3><div class="team-info"><strong>Captain:</strong> ${escapeHTML(team.profiles?.full_name||"Unknown")}<br><strong>Members:</strong> ${count||0}<br><strong>Your Role:</strong> ${escapeHTML(m.role||"member")}</div><div class="action-row"><button class="btn-3d-sm-white-glow" onclick="viewTeamDetails('${team.id}')">📋 MANAGE</button>${!isCaptain?`<button class="btn-3d-sm-white-glow-danger" onclick="leaveTeam('${team.id}')">🚪 LEAVE</button>`:''}</div>`;
        list.appendChild(card);
    }
}

async function viewTeamDetails(teamId){
    document.getElementById("teamDetailsPage").classList.remove("hidden");
    document.getElementById("studentDashboard").classList.add("hidden");
    document.getElementById("teamDetailsContent").innerHTML="<div class='empty-box'>Loading team details...</div>";
    const {data:team,error}=await client.from("teams").select(`id,name,college_id,captain_id,created_at,profiles!teams_captain_id_fkey(full_name,inter_rivalry_id)`).eq("id",teamId).single();
    if(error||!team){ document.getElementById("teamDetailsContent").innerHTML="<div class='empty-box'>Team not found.</div>"; return; }
    const {data:{user}}=await client.auth.getUser();
    const isCaptain=team.captain_id===user?.id;
    const {data:members}=await client.from("team_members").select(`user_id,role,profiles(full_name,inter_rivalry_id)`).eq("team_id",teamId);
    const {data:invites}=await client.from("team_invites").select(`id,invitee_id,status,created_at,profiles!team_invites_invitee_id_fkey(full_name,inter_rivalry_id)`).eq("team_id",teamId).eq("status","pending");
    const memberIds=(members||[]).map(m=>m.user_id);
    const {data:allStudents}=await client.from("profiles").select("id,full_name,inter_rivalry_id").eq("role","student").not("id","in",`(${memberIds.length?memberIds.join(','):''})`);
    let html=`<div class="profile-card"><h2>👥 ${escapeHTML(team.name)}</h2><div class="team-info"><strong>Captain:</strong> ${escapeHTML(team.profiles?.full_name||"Unknown")}<br><strong>ID:</strong> ${escapeHTML(team.profiles?.inter_rivalry_id||"-")}<br><strong>Created:</strong> ${formatDate(team.created_at)}<br><strong>Members:</strong> ${members?.length||0}</div></div>`;
    if(isCaptain&&allStudents&&allStudents.length>0){
        html+=`<div class="profile-card"><h3>📩 Invite Players</h3><div class="invite-row"><select id="invitePlayerSelect"><option value="">Select a player...</option>${allStudents.map(s=>`<option value="${s.id}">${escapeHTML(s.full_name)} (${escapeHTML(s.inter_rivalry_id||"-")})</option>`).join("")}</select><button class="btn-3d-sm-white-glow" onclick="sendTeamInvite('${teamId}')">📨 SEND INVITE</button></div><div id="teamInviteMessage" class="message"></div></div>`;
    }
    if(invites&&invites.length>0){
        html+=`<h3 style="margin-top:20px">📨 Pending Invites</h3>${invites.map(inv=>`<div class="invite-card"><h4>👤 ${escapeHTML(inv.profiles?.full_name||"Unknown")}</h4><div class="invite-info">ID: ${escapeHTML(inv.profiles?.inter_rivalry_id||"-")}<br>Status: <span class="status-pill status-pending">Pending</span></div>${isCaptain?`<div class="invite-actions"><button class="btn-3d-sm-white-glow-danger" onclick="cancelTeamInvite('${inv.id}')">❌ CANCEL</button></div>`:''}</div>`).join("")}`;
    }
    html+=`<h3 style="margin-top:20px">👥 Members</h3>${(members||[]).map(m=>`<div class="invite-card"><h4>${escapeHTML(m.profiles?.full_name||"Unknown")} ${m.role==='captain'?'👑':''}</h4><div class="invite-info">ID: ${escapeHTML(m.profiles?.inter_rivalry_id||"-")}<br>Role: ${escapeHTML(m.role||"member")}</div>${isCaptain&&m.role!=='captain'?`<div class="invite-actions"><button class="btn-3d-sm-white-glow-danger" onclick="removeTeamMember('${teamId}','${m.user_id}')">🗑️ REMOVE</button></div>`:''}</div>`).join("")||"<div class='empty-box'>No members yet.</div>"}`;
    if(isCaptain){ html+=`<div style="margin-top:20px"><button class="btn-3d-sm-white-glow-danger" onclick="deleteTeam('${teamId}')">🗑️ DELETE TEAM</button></div>`; }
    document.getElementById("teamDetailsContent").innerHTML=html;
    document.getElementById("teamDetailsContent").dataset.teamId=teamId;
}

async function createTeam(){
    const overlay=document.createElement('div');
    overlay.style.cssText=`position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;padding:20px;backdrop-filter:blur(10px);`;
    const modal=document.createElement('div');
    modal.style.cssText=`background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:40px;max-width:450px;width:100%;`;
    modal.innerHTML=`
        <h2 style="color:white;text-align:center;margin-bottom:10px;">👥 Create Team</h2>
        <p style="color:#888;text-align:center;margin-bottom:25px;">Enter your team name below</p>
        <div style="margin-bottom:20px;"><label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">🏷️ Team Name</label>
        <input id="teamNameInput" type="text" placeholder="Type team name..." style="width:100%;padding:14px;background:#0a0a0a;border:1px solid #333;border-radius:10px;color:white;font-size:16px;text-align:center;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button id="confirmTeamBtn" class="btn-3d-white-glow">✅ CREATE</button>
            <button id="cancelTeamBtn" class="btn-3d-sm-white-glow-danger">❌ CANCEL</button>
        </div>
        <div id="teamCreateMessage" style="color:#888;text-align:center;margin-top:12px;"></div>
    `;
    overlay.appendChild(modal); document.body.appendChild(overlay);
    document.getElementById('cancelTeamBtn').addEventListener('click',function(){ document.body.removeChild(overlay); });
    document.getElementById('confirmTeamBtn').addEventListener('click',async function(){
        const name=document.getElementById('teamNameInput').value.trim();
        const msg=document.getElementById('teamCreateMessage');
        if(!name){ msg.textContent='⚠️ Please enter a team name'; msg.style.color='#ff6b6b'; return; }
        this.textContent='⏳ CREATING...'; this.disabled=true;
        const {data:{user}}=await client.auth.getUser();
        if(!user){ msg.textContent='Please login first'; msg.style.color='#ff6b6b'; this.textContent='✅ CREATE'; this.disabled=false; return; }
        const {data:existing}=await client.from("team_members").select("team_id").eq("user_id",user.id).limit(1);
        if(existing&&existing.length>0){ msg.textContent='⚠️ You\'re already in a team!'; msg.style.color='#ff6b6b'; this.textContent='✅ CREATE'; this.disabled=false; return; }
        const {data:membership}=await client.from("college_memberships").select("college_id").eq("user_id",user.id).eq("is_active",true).maybeSingle();
        const {data:team,error}=await client.from("teams").insert({name,captain_id:user.id,college_id:membership?.college_id||null}).select("id").single();
        if(error){ msg.textContent='❌ '+error.message; msg.style.color='#ff6b6b'; this.textContent='✅ CREATE'; this.disabled=false; return; }
        await client.from("team_members").insert({team_id:team.id,user_id:user.id,role:"captain"});
        msg.textContent='✅ Team created! 🎉'; msg.style.color='#00b894';
        document.getElementById('teamNameInput').value='';
        setTimeout(()=>{ document.body.removeChild(overlay); backToStudentDashboard(); loadMyTeams(); },1500);
    });
    overlay.addEventListener('click',function(e){ if(e.target===overlay) document.body.removeChild(overlay); });
}

async function sendTeamInvite(teamId){
    const select=document.getElementById("invitePlayerSelect");
    const inviteeId=select?.value;
    const msg=document.getElementById("teamInviteMessage");
    if(!inviteeId){ msg.textContent="Select a player."; return; }
    const {data:{user}}=await client.auth.getUser();
    if(!user){ msg.textContent="Please login."; return; }
    const {data:existing}=await client.from("team_invites").select("id").eq("team_id",teamId).eq("invitee_id",inviteeId).eq("status","pending").limit(1);
    if(existing?.length){ msg.textContent="Invite already sent."; return; }
    msg.textContent="Sending invite...";
    const {error}=await client.from("team_invites").insert({team_id:teamId,sender_id:user.id,invitee_id:inviteeId,status:"pending"});
    if(error){ msg.textContent="Error: "+error.message; return; }
    msg.textContent="✅ Invite sent!";
    select.value="";
    setTimeout(()=>viewTeamDetails(teamId),1000);
}

async function cancelTeamInvite(inviteId){
    if(!confirm("Cancel this invite?")) return;
    await client.from("team_invites").delete().eq("id",inviteId);
    const teamId=document.getElementById("teamDetailsContent")?.dataset?.teamId;
    if(teamId) viewTeamDetails(teamId);
    else loadMyTeams();
}

async function acceptTeamInvite(inviteId){
    const {data:{user}}=await client.auth.getUser();
    if(!user) return;
    const {data:existing}=await client.from("team_members").select("team_id").eq("user_id",user.id).limit(1);
    if(existing?.length){ alert("You're already in a team!"); return; }
    const {data:invite}=await client.from("team_invites").select("team_id").eq("id",inviteId).single();
    if(!invite){ alert("Invite not found."); return; }
    await client.from("team_invites").update({status:"accepted"}).eq("id",inviteId);
    await client.from("team_members").insert({team_id:invite.team_id,user_id:user.id,role:"member"});
    alert("✅ You joined the team!");
    loadMyTeams(); loadTeamInvites();
}

async function declineTeamInvite(inviteId){
    if(!confirm("Decline this invite?")) return;
    await client.from("team_invites").update({status:"declined"}).eq("id",inviteId);
    loadTeamInvites();
}

async function loadTeamInvites(){
    const list=document.getElementById("teamInvitesList");
    if(!list) return;
    list.innerHTML="<div class='empty-box'>Loading invites...</div>";
    const {data:{user}}=await client.auth.getUser();
    if(!user){ list.innerHTML="<div class='empty-box'>Please login.</div>"; return; }
    const {data:invites,error}=await client.from("team_invites").select(`id,team_id,status,created_at,sender_id,profiles!team_invites_sender_id_fkey(full_name,inter_rivalry_id),teams(id,name,captain_id)`).eq("invitee_id",user.id).eq("status","pending").order("created_at",{ascending:false});
    if(error||!invites||invites.length===0){ list.innerHTML="<div class='empty-box'>No pending team invites.</div>"; return; }
    list.innerHTML="";
    for(const inv of invites){
        const card=document.createElement("div");
        card.className="invite-card";
        card.innerHTML=`<h4>👥 ${escapeHTML(inv.teams?.name||"Team")}</h4><div class="invite-info"><strong>From:</strong> ${escapeHTML(inv.profiles?.full_name||"Unknown")}<br><strong>ID:</strong> ${escapeHTML(inv.profiles?.inter_rivalry_id||"-")}<br><strong>Sent:</strong> ${formatDate(inv.created_at)}</div><div class="invite-actions"><button class="btn-3d-sm-white-glow" onclick="acceptTeamInvite('${inv.id}')">✅ ACCEPT</button><button class="btn-3d-sm-white-glow-danger" onclick="declineTeamInvite('${inv.id}')">❌ DECLINE</button></div>`;
        list.appendChild(card);
    }
}

async function leaveTeam(teamId){
    if(!confirm("Leave this team?")) return;
    const {data:{user}}=await client.auth.getUser();
    if(!user) return;
    await client.from("team_members").delete().eq("team_id",teamId).eq("user_id",user.id);
    loadMyTeams();
}

async function removeTeamMember(teamId,userId){
    if(!confirm("Remove this member?")) return;
    await client.from("team_members").delete().eq("team_id",teamId).eq("user_id",userId);
    viewTeamDetails(teamId);
    loadMyTeams();
}

async function deleteTeam(teamId){
    if(!confirm("⚠️ Delete this team permanently?")) return;
    const {error}=await client.from("teams").delete().eq("id",teamId);
    if(error) alert("Error: "+error.message);
    else { alert("Team deleted."); backToStudentDashboard(); loadMyTeams(); }
}

// ===== TOGGLE RIVALS =====
function toggleRivals(){
    const section=document.getElementById("rivalsSubSection");
    const btn=document.querySelector(".btn-3d-white-glow-gold[onclick='toggleRivals()']");
    rivalsVisible=!rivalsVisible;
    if(rivalsVisible){
        section.style.display="block";
        btn.textContent="❌ CLOSE RIVALS";
        btn.style.background="linear-gradient(180deg,#e17055,#c0392b)";
        btn.style.boxShadow="0 8px 0 #78281f,0 8px 25px rgba(255,80,80,0.15)";
        btn.style.color="white";
        btn.style.borderColor="rgba(255,80,80,0.3)";
        loadRivalsData();
    } else {
        section.style.display="none";
        btn.textContent="⚔️ FIND RIVALS";
        btn.style.background="linear-gradient(180deg,#fdcb6e,#f39c12)";
        btn.style.boxShadow="0 8px 0 #b7791f,0 8px 25px rgba(255,215,0,0.15)";
        btn.style.color="#2d3436";
        btn.style.borderColor="rgba(255,215,0,0.3)";
    }
}

// ===== LOAD RIVALS =====
async function loadRivalsData(){
    const list=document.getElementById("rivalsList");
    if(!list) return;
    if(rivalsLoaded&&allRivalsData.length){
        displayRivalsByCategory('all');
        return;
    }
    if(rivalsLoading) return;
    rivalsLoading=true;
    list.innerHTML="<div class='empty-box'>⏳ Loading students...</div>";
    const {data:{user}}=await client.auth.getUser();
    if(!user){ list.innerHTML="<div class='empty-box'>Please login first.</div>"; rivalsLoading=false; return; }
    try {
        const {data:profiles,error}=await client.from("profiles").select("id, full_name, inter_rivalry_id, role").neq("id",user.id).eq("role","student").order("full_name",{ascending:true});
        if(error){ list.innerHTML=`<div class='empty-box'>${escapeHTML(error.message)}</div>`; rivalsLoading=false; return; }
        if(!profiles||profiles.length===0){ list.innerHTML="<div class='empty-box'>No students found.</div>"; rivalsLoading=false; return; }
        const ids=profiles.map(p=>p.id);
        const [membershipsResult,interestsResult]=await Promise.all([
            client.from("college_memberships").select("user_id, course, year_of_study, specialization, colleges(college_name)").in("user_id",ids).eq("is_active",true),
            client.from("participations").select("user_id, subcategories(name, categories(name))").in("user_id",ids)
        ]);
        const memberships=membershipsResult.data||[];
        const interests=interestsResult.data||[];
        allRivalsData=profiles.map(profile=>{
            const membership=memberships.find(m=>m.user_id===profile.id)||{};
            const userInterests=interests.filter(i=>i.user_id===profile.id)||[];
            const tags=[...new Set(userInterests.map(i=>i.subcategories?.categories?.name).filter(Boolean))];
            return {...profile, course:membership?.course||'Unknown', year:membership?.year_of_study||null, college:membership?.colleges?.college_name||'Unknown', specialization:membership?.specialization||null, interests:tags.slice(0,8)};
        });
        rivalsLoaded=true;
        displayRivalsByCategory('all');
    } catch(err){ list.innerHTML=`<div class='empty-box'>Error: ${escapeHTML(err.message)}</div>`; }
    rivalsLoading=false;
}

function displayRivalsByCategory(category){
    const list=document.getElementById("rivalsList");
    const data=allRivalsData||[];
    if(!data.length){ list.innerHTML="<div class='empty-box'>No students found.</div>"; return; }
    let filtered=data;
    if(category!=='all'){ filtered=data.filter(s=>s.course===category); }
    if(!filtered.length){ list.innerHTML=`<div class='empty-box'>No students found in ${category} category.</div>`; return; }
    const grouped={};
    filtered.forEach(student=>{
        const course=student.course||'Unknown';
        const year=student.year||0;
        const yearLabel=year===1?'1st Year':year===2?'2nd Year':year===3?'3rd Year':`${year}th Year`;
        if(!grouped[course]) grouped[course]={};
        if(!grouped[course][yearLabel]) grouped[course][yearLabel]=[];
        grouped[course][yearLabel].push(student);
    });
    let html='';
    const courseOrder=['BCA','BBA','B.COM'];
    const sortedCourses=Object.keys(grouped).sort((a,b)=>{
        const indexA=courseOrder.indexOf(a);
        const indexB=courseOrder.indexOf(b);
        if(indexA===-1&&indexB===-1) return a.localeCompare(b);
        if(indexA===-1) return 1;
        if(indexB===-1) return -1;
        return indexA-indexB;
    });
    sortedCourses.forEach(course=>{
        const years=grouped[course];
        const yearKeys=Object.keys(years).sort((a,b)=>{ const numA=parseInt(a); const numB=parseInt(b); return numA-numB; });
        let courseColor='#6c5ce7';
        if(course==='BCA') courseColor='#6c5ce7';
        else if(course==='BBA') courseColor='#00b894';
        else if(course==='B.COM') courseColor='#fdcb6e';
        html+=`<div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:20px;margin-bottom:16px;">
            <h2 style="color:${courseColor};margin-bottom:15px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">${course==='BCA'?'💻':course==='BBA'?'📊':'💰'}</span>
                ${escapeHTML(course)}
                <span style="font-size:14px;color:#888;font-weight:400;">(${filtered.filter(s=>s.course===course).length} students)</span>
            </h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:15px;">`;
        yearKeys.forEach(year=>{
            const students=years[year];
            html+=`<div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="color:#00d2ff;font-size:16px;">📅 ${escapeHTML(year)}</h3>
                    <span style="background:#1a1a1a;padding:4px 12px;border-radius:999px;font-size:12px;color:#888;">${students.length} students</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">`;
            students.forEach(student=>{
                const name=student.full_name||'Unknown';
                const rivalryId=student.inter_rivalry_id||'Not assigned';
                const spec=student.specialization||'';
                const tags=student.interests||[];
                html+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0a0a0a;border-radius:8px;border-left:3px solid ${courseColor};">
                    <div><span style="font-weight:600;">👤 ${escapeHTML(name)}</span>
                    <br><span style="font-size:11px;color:#666;">ID: ${escapeHTML(rivalyId)}</span>
                    ${spec?`<br><span style="font-size:11px;color:#888;">🎯 ${escapeHTML(spec)}</span>`:''}
                    ${tags.length?`<br><span style="font-size:10px;color:#555;">${tags.map(t=>`#${escapeHTML(t)}`).join(' ')}</span>`:''}</div>
                    <button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:10px;" onclick="viewProfile('${student.id}')">VIEW</button>
                </div>`;
            });
            html+=`</div></div>`;
        });
        html+=`</div></div>`;
    });
    list.innerHTML=html;
    document.querySelectorAll('#rivalsSubSection .filter-btn').forEach(btn=>{
        btn.style.opacity='0.5'; btn.style.transform='scale(0.95)';
    });
    const activeBtn=document.getElementById(`rivalFilter${category==='all'?'All':category}`);
    if(activeBtn){ activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
}

function filterRivals(category){ displayRivalsByCategory(category); }

// ===== INITIALIZE =====
console.log("INTER RIVALRY - Starting...");

async function initialize() {
    console.log("Initializing app...");
    try {
        const {data:{session}}=await client.auth.getSession();
        if(session){
            console.log("User is logged in");
            await loadUser();
        } else {
            console.log("No user logged in");
            showAuth();
        }
    } catch(error){
        console.error("Error initializing:", error);
        showAuth();
    }
    setTimeout(()=>{
        document.getElementById("loadingScreen").classList.add("hidden");
    },500);
}

// Start the app
initialize();
