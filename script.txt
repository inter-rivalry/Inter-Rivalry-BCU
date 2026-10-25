// ==================== SUPABASE CONFIG ====================
const SUPABASE_URL = "https://qfkxvflyzucvkeyucbzn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Se88Rw_onDUYfnMHxogs2g_q6WGY_3T";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ==================== PUSH NOTIFICATIONS ====================
// Replace this with the PUBLIC VAPID key generated for INTER RIVALRY.
// Never put the VAPID private key or Supabase service-role key in this HTML.
const VAPID_PUBLIC_KEY = "BG-vGvCaq8JgPSTbT8onKXHFLyzQGsLGEUoVtJRZ5Gz4h6n3v29eCyFzKuFfex6R-PZaukbi9u_h8MkZlz29SwI";
let pushRegistration = null;
let pushSubscription = null;

function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

async function enablePushNotifications() {
    const btn = document.getElementById("pushNotificationBtn");
    try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
            alert("Push notifications are not supported by this browser.");
            return;
        }
        if (VAPID_PUBLIC_KEY === "PASTE_VAPID_PUBLIC_KEY_HERE") {
            alert("Push notification setup is not finished yet. The VAPID public key still needs to be added.");
            return;
        }

        const { data: { user } } = await client.auth.getUser();
        if (!user) {
            alert("Please log in first.");
            return;
        }

        if (btn) { btn.disabled = true; btn.textContent = "🔄 SETTING UP..."; }

        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
            if (btn) { btn.disabled = false; btn.textContent = "🔔 ENABLE PUSH"; }
            alert("Notification permission was not granted.");
            return;
        }

        pushRegistration = await navigator.serviceWorker.register('./sw.js');
        await navigator.serviceWorker.ready;

        // IMPORTANT: VAPID keys were rotated. Always replace an existing
        // browser subscription so it is created with the current public key.
        pushSubscription = await pushRegistration.pushManager.getSubscription();

        if (pushSubscription) {
            try {
                await pushSubscription.unsubscribe();
            } catch (unsubscribeError) {
                console.warn('Could not remove old push subscription:', unsubscribeError);
            }
            pushSubscription = null;
        }

        pushSubscription = await pushRegistration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });

        const json = pushSubscription.toJSON();
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
            throw new Error("Browser returned an invalid push subscription.");
        }

        const { error } = await client.from('push_subscriptions').upsert({
            user_id: user.id,
            endpoint: json.endpoint,
            p256dh: json.keys.p256dh,
            auth: json.keys.auth,
            user_agent: navigator.userAgent,
            updated_at: new Date().toISOString()
        }, { onConflict: 'endpoint' });

        if (error) throw error;

        if (btn) { btn.disabled = false; btn.textContent = "✅ PUSH ON"; }
        alert("Push notifications are enabled on this device!");
    } catch (error) {
        console.error('Push notification setup failed:', error);
        if (btn) { btn.disabled = false; btn.textContent = "🔔 ENABLE PUSH"; }
        alert("Could not enable push notifications: " + error.message);
    }
}

async function restorePushNotificationState() {
    const btn = document.getElementById("pushNotificationBtn");
    if (!btn || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
        pushRegistration = await navigator.serviceWorker.getRegistration('./');
        if (!pushRegistration) return;
        pushSubscription = await pushRegistration.pushManager.getSubscription();
        if (pushSubscription && Notification.permission === 'granted') {
            btn.textContent = "✅ PUSH ON";
        }
    } catch (e) {
        console.warn('Could not restore push state:', e);
    }
}


// ==================== GLOBALS ====================
let selectedCollegeId = null;
let selectedProfileId = null;
let allRivalsData = [];
let rivalsVisible = false;
let currentUserRole = '';
let currentUserProfile = null;
let currentAdminCollegeId = null;
let selectedChallengeMode = "solo";

// ==================== GRADE HELPER FUNCTIONS ====================
function getGrade(percentage) {
    if (percentage >= 90) return 'A+';
    if (percentage >= 80) return 'A';
    if (percentage >= 70) return 'B';
    if (percentage >= 60) return 'C';
    if (percentage >= 50) return 'D';
    if (percentage >= 40) return 'E';
    return 'F';
}

function getGPA(percentage) {
    if (percentage >= 90) return 10.0;
    if (percentage >= 80) return 9.0;
    if (percentage >= 70) return 8.0;
    if (percentage >= 60) return 7.0;
    if (percentage >= 50) return 6.0;
    if (percentage >= 40) return 5.0;
    return 0.0;
}

function escapeHTML(value){ if(value === null || value === undefined) return ""; return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function formatDate(value){ if(!value) return "-"; const date = new Date(value); if(isNaN(date.getTime())) return "-"; return date.toLocaleString(); }

// ==================== AUTH FUNCTIONS ====================
function showMessage(msg){ document.getElementById("authMessage").textContent = msg; }
function showSignup(){ document.getElementById("loginForm").classList.add("hidden"); document.getElementById("signupForm").classList.remove("hidden"); showMessage(""); }
function showLogin(){ document.getElementById("signupForm").classList.add("hidden"); document.getElementById("loginForm").classList.remove("hidden"); showMessage(""); }
function showAuth(){ hideAll(); document.getElementById("authPage").classList.remove("hidden"); }

function isPasswordRecoveryUrl(){
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    return hash.includes("type=recovery") || search.includes("type=recovery");
}

function showResetPassword(){
    hideAll();
    document.getElementById("resetPasswordPage").classList.remove("hidden");
    document.getElementById("resetNewPassword").value = "";
    document.getElementById("resetConfirmPassword").value = "";
    const msg = document.getElementById("resetPasswordMessage");
    if(msg) msg.textContent = "";
}

async function updateResetPassword(){
    const password = document.getElementById("resetNewPassword").value;
    const confirmPassword = document.getElementById("resetConfirmPassword").value;
    const msg = document.getElementById("resetPasswordMessage");

    if(!password || !confirmPassword){
        msg.textContent = "Please enter both password fields.";
        return;
    }
    if(password.length < 6){
        msg.textContent = "Password must be at least 6 characters.";
        return;
    }
    if(password !== confirmPassword){
        msg.textContent = "Passwords do not match.";
        return;
    }

    msg.textContent = "Updating password...";
    const { error } = await client.auth.updateUser({ password });
    if(error){
        console.error("PASSWORD UPDATE ERROR:", error);
        msg.textContent = "❌ " + error.message;
        return;
    }

    msg.textContent = "✅ Password updated successfully! You can now log in with your new password.";
    window.history.replaceState({}, document.title, window.location.pathname);
    setTimeout(async () => {
        await client.auth.signOut();
        showAuth();
    }, 1200);
}

async function signup(){
    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    const sex = document.getElementById("signupSex")?.value || "";
    if(!name || !email || !password || !sex){ showMessage("Please fill in all required fields, including Sex."); return; }
    if(password.length < 6){ showMessage("Password must be at least 6 characters."); return; }
    showMessage("Creating account...");
    
    const { data, error } = await client.auth.signUp({
        email, password,
        options: {
            emailRedirectTo: "https://inter-rivalry.github.io/Inter-Rivalry-BCU/",
            data: { full_name: name }
        }
    });
    
    if(error){ showMessage(error.message); return; }
    if(!data.session){ showMessage("Account created! Check your email to confirm."); return; }
    
    const { error: profileError } = await client
        .from("profiles")
        .insert({
            id: data.user.id,
            full_name: name,
            role: 'student',
            inter_rivalry_id: null,
            sex: sex
        });
    
    if(profileError){
        console.error("Profile creation error:", profileError);
        showMessage("Account created but profile setup failed. Please contact support.");
        return;
    }
    
    showMessage("✅ Account created! Next, set your location to create your Local Profile. You can join a College or Gym later.");
    await loadUser();
}

async function login(){
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if(!email || !password){ showMessage("Please enter your email and password."); return; }
    showMessage("Logging in...");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if(error){ showMessage(error.message); return; }
    await loadUser();
}

async function forgotPassword(){
    const email = document.getElementById("loginEmail").value.trim();
    if(!email){ showMessage("Enter your email first."); return; }
    showMessage("Sending reset email...");
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: "https://inter-rivalry.github.io/Inter-Rivalry-BCU/" });
    if(error){ showMessage(error.message); return; }
    showMessage("Password reset email sent!");
}

async function resendConfirmationEmail(){
    const email = document.getElementById("loginEmail").value.trim();
    if(!email){ showMessage("Enter your email first."); return; }
    showMessage("Sending confirmation email...");
    const { error } = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: "https://inter-rivalry.github.io/Inter-Rivalry-BCU/" } });
    if(error){ showMessage(error.message); return; }
    showMessage("Confirmation email sent!");
}

async function logout(){
    await client.auth.signOut();
    selectedCollegeId = null;
    selectedProfileId = null;
    showAuth();
}

// ==================== NAVIGATION ====================
function hideAll(){
    document.getElementById("localClubPage")?.classList.add("hidden");
    document.getElementById("activityCenterPage")?.classList.add("hidden");
    document.querySelectorAll("section").forEach(s => s.classList.add("hidden"));
    document.getElementById("loadingScreen").classList.add("hidden");
    document.getElementById("leaderboardPage").classList.add("hidden");
    document.getElementById("tournamentsPage").classList.add("hidden");
    document.getElementById("categoryRankingsPage").classList.add("hidden");
    document.getElementById("myClassPage").classList.add("hidden");
    document.getElementById("gradeBookPage").classList.add("hidden");
    document.getElementById("gradeLeaderboardPage").classList.add("hidden");
    document.getElementById("quizBattlePage").classList.add("hidden");
    document.getElementById("myProfilePage").classList.add("hidden");
}

function backToStudentDashboard(){
    document.getElementById("createTeamPage").classList.add("hidden");
    document.getElementById("teamDetailsPage").classList.add("hidden");
    document.getElementById("myClassPage").classList.add("hidden");
    document.getElementById("myProfilePage").classList.add("hidden");
    document.getElementById("gradeBookPage").classList.add("hidden");
    document.getElementById("gradeLeaderboardPage").classList.add("hidden");
    document.getElementById("localClubPage")?.classList.add("hidden");
    document.getElementById("activityCenterPage")?.classList.add("hidden");
    document.getElementById("studentDashboard").classList.remove("hidden");
    loadMyTeams();
    loadTeamInvites();
    loadMyQuickStats();
    loadNotifications();
    selectBattlefield(currentBattlefield);
    loadActivityPreview();
    loadStudentDashboardFromCurrentUser();
}

function backToProfile(){ document.getElementById("profilePage").classList.remove("hidden"); document.getElementById("challengePage").classList.add("hidden"); }
async function backToAdmin(){
    selectedCollegeId = currentAdminCollegeId || null;
    const role = String(currentUserRole || "").toLowerCase().replace(/[\s-]/g, "_");
    const { data: { user } } = await client.auth.getUser();
    if(role === "college_admin" || role === "collegeadmin"){
        if(user) await loadCollegeAdminDashboard(user, currentUserProfile);
        return;
    }
    await loadAdminDashboard();
}
function backToManagement(){ document.getElementById("collegeManagement").classList.remove("hidden"); }
function showOnlyStudent(){ hideAll(); document.getElementById("studentDashboard").classList.remove("hidden"); }
function showOnlyProfile(){ hideAll(); document.getElementById("profilePage").classList.remove("hidden"); }
function showMyProfile(){
    hideAll();
    document.getElementById("myProfilePage").classList.remove("hidden");
    const adminButtons = [
        document.getElementById("profileCollegeAdminBtn"),
        document.getElementById("myProfileCollegeAdminBtn")
    ].filter(Boolean);
    const normalizedRole = String(currentUserProfile?.role || "")
        .toLowerCase()
        .replace(/[\s-]/g, "_");
    const canUseCollegeAdmin = ["college_admin", "collegeadmin"].includes(normalizedRole);
    adminButtons.forEach(button => {
        button.style.display = canUseCollegeAdmin ? "inline-block" : "none";
    });
    loadMyProfilePage();
}

async function openCollegeAdminFromProfile(){
    const role = String(currentUserProfile?.role || "")
        .toLowerCase()
        .replace(/[\s-]/g, "_");
    if(!["college_admin", "collegeadmin"].includes(role)){
        alert("College Admin access is not available for this account.");
        return;
    }
    const { data: { user } } = await client.auth.getUser();
    if(!user) return;
    await loadCollegeAdminDashboard(user, currentUserProfile);
}
function showMyClass(){ hideAll(); document.getElementById("myClassPage").classList.remove("hidden"); loadClassRepresentativeCard(); loadMyClass(); }
function showOnlyChallenge(){ hideAll(); document.getElementById("challengePage").classList.remove("hidden"); }
function showOnlyMyChallenges(){ hideAll(); document.getElementById("myChallengesPage").classList.remove("hidden"); loadMyChallenges(); }
function showQuizBattles(){ hideAll(); document.getElementById("quizBattlePage").classList.remove("hidden"); document.getElementById("quizCreateBox").style.display="none"; document.getElementById("quizBattlesListBox").style.display="block"; loadQuizBattles(); }
function openQuizBattleCreate(){
    if(!selectedProfileId){ alert("No opponent selected."); return; }
    hideAll();
    document.getElementById("quizBattlePage").classList.remove("hidden");
    document.getElementById("quizCreateBox").style.display="block";
    document.getElementById("quizBattlesListBox").style.display="none";
    loadQuizOpponent();
}
function showOnlyAdmin(){ hideAll(); document.getElementById("adminDashboard").classList.remove("hidden"); }
function showOnlyCollegeManagement(){ hideAll(); document.getElementById("collegeManagement").classList.remove("hidden"); }
function showOnlyAdmins(){ hideAll(); document.getElementById("adminsPage").classList.remove("hidden"); }
function showOnlyStudents(){ hideAll(); document.getElementById("studentsPage").classList.remove("hidden"); }
function showOnlyRequests(){ hideAll(); document.getElementById("requestsPage").classList.remove("hidden"); }
function showOnlyInterests(){ hideAll(); document.getElementById("interestsPage").classList.remove("hidden"); loadInterestsEditor(); }
function showOnlyResults(){ hideAll(); document.getElementById("resultsPage").classList.remove("hidden"); loadResults(); }
function showCreateTeam(){ document.getElementById("createTeamPage").classList.remove("hidden"); document.getElementById("studentDashboard").classList.add("hidden"); }
function showLeaderboard(){
    hideAll();
    document.getElementById("leaderboardPage").classList.remove("hidden");
    const bf=normalizeBattlefield(currentBattlefield || 'local');
    const localControls=document.getElementById('localRankingControls'); if(localControls) localControls.classList.toggle('hidden', bf!=='local');
    const collegeControls=document.getElementById('collegeRankingCourseControls'); if(collegeControls) collegeControls.classList.toggle('hidden', bf!=='college');
    if(bf==='local'){ initLocalRankingControls(); setLocalRankingMode('state'); }
    showRankingView('overall');
    loadLeaderboard('overall');
}
function showRankingView(view){
    const overall = document.getElementById('overallRankingPanel');
    const category = document.getElementById('mergedCategoryRankingPanel');
    const overallBtn = document.getElementById('rankingViewOverall');
    const categoryBtn = document.getElementById('rankingViewCategory');
    const isOverall = view === 'overall';
    if(overall) overall.classList.toggle('hidden', !isOverall);
    if(category) category.classList.toggle('hidden', isOverall);
    if(overallBtn){ overallBtn.style.opacity = isOverall ? '1' : '0.55'; overallBtn.style.transform = isOverall ? 'scale(1)' : 'scale(.98)'; }
    if(categoryBtn){ categoryBtn.style.opacity = isOverall ? '0.55' : '1'; categoryBtn.style.transform = isOverall ? 'scale(.98)' : 'scale(1)'; }
    if(!isOverall) loadMergedCategoryRankings('all');
}
function showCategoryRankings(){
    // Kept for compatibility with older links/bookmarks. Rankings now live in one page.
    showLeaderboard();
    showRankingView('category');
}
function showTournaments(){
    hideAll();
    const page=document.getElementById("tournamentsPage");
    if(page) page.classList.remove("hidden");
    const battlefield=(typeof normalizeBattlefield==='function' ? normalizeBattlefield(currentBattlefield||'local') : (currentBattlefield||'local'));
    const title=document.getElementById('tournamentBattlefieldTitle');
    const desc=document.getElementById('tournamentBattlefieldDescription');
    if(title) title.textContent=battlefield==='college'?'College':battlefield==='gym'?'Gym':'Local';
    if(desc) desc.textContent=battlefield==='college'?'Only tournaments assigned to your College Profile.':battlefield==='gym'?'Only tournaments assigned to your Gym Profile.':'Only tournaments assigned to your Local Profile.';
    loadTournaments('all');
}
function showGradeBook(){ hideAll(); document.getElementById("gradeBookPage").classList.remove("hidden"); loadGradeBook(1); }
function showGradeLeaderboard(){ hideAll(); document.getElementById("gradeLeaderboardPage").classList.remove("hidden"); loadGradeLeaderboard(1); }

// ==================== LOAD USER ====================
async function loadUser(){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ showAuth(); return; }
    const { data: profile, error } = await client.from("profiles").select("*").eq("id",user.id).single();
    if(error || !profile){ console.error(error); showAuth(); return; }
    currentUserRole = profile.role || '';
    currentUserProfile = profile;

    const normalizedRole = String(profile.role || '').toLowerCase().replace(/[\s-]/g, '_');
    const canUseCollegeAdmin = ['college_admin', 'collegeadmin'].includes(normalizedRole);
    ['profileCollegeAdminBtn', 'myProfileCollegeAdminBtn'].forEach(id => {
        const button = document.getElementById(id);
        if(button) button.style.display = canUseCollegeAdmin ? 'inline-block' : 'none';
    });
    
    if(normalizedRole === "super_admin"){
        await loadAdminDashboard();
        return;
    }

    // College admins remain students. Always open the student dashboard first.
    if(["college_admin", "collegeadmin"].includes(normalizedRole)){
        await loadStudentDashboard(user, profile);
        return;
    }

    await loadStudentDashboard(user, profile);
}

async function loadStudentDashboardFromCurrentUser(){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ showAuth(); return; }
    const { data: profile } = await client.from("profiles").select("*").eq("id",user.id).single();
    if(profile){ 
        currentUserProfile = profile;
        await loadStudentDashboard(user, profile); 
    }
}

// ==================== COLLEGE ADMIN DASHBOARD ====================





// ==================== STUDENT DASHBOARD ====================
async function loadStudentDashboard(user, profile){
    document.getElementById("userName").textContent = profile.full_name || "Student";

    // Local is the default/normal profile. Ask for location before anything else.
    const localReady = await ensureLocalProfile(user.id);
    if(!localReady){
        showOnlyStudent();
        return;
    }

    // Existing users can add their mobile number now. OTP verification is intentionally deferred.
    const mobileReady = await ensureMobileNumber(user.id);
    if(!mobileReady){
        showOnlyStudent();
        return;
    }

    // Always land on the Local Profile after login. Student/Gym Profiles are entered explicitly.
    currentBattlefield = 'local';

    const { data: membership } = await client
        .from("college_memberships")
        .select("college_id,department,course,year_of_study,specialization,colleges(college_name,college_code,city,state)")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

    const collegeStatus = document.getElementById("collegeStatus");
    const hasJoinedCollege = membership && membership.colleges;

    if(!hasJoinedCollege){
        document.getElementById("studentCollegeSection").style.display = "none";
        document.getElementById("myQuickStats").innerHTML = "";
        document.getElementById("teamsSection").style.display = "none";
        document.getElementById("teamInvitesSection").style.display = "none";
        document.getElementById("battlefieldSection").style.display = "block";
        document.getElementById("rivalsSectionFull").style.display = "block";
        document.getElementById("actionButtons").style.display = "flex";
        document.getElementById("bottomButtons").style.display = "grid";
        document.getElementById("adminActionButtons").style.display = "none";
        document.getElementById("rivalryId").textContent = profile.inter_rivalry_id || "Local Profile";
        document.getElementById("rivalryId").style.color = "#00b894";
        collegeStatus.textContent = "🎓 College: Not joined yet";
        collegeStatus.style.color = "#fdcb6e";
        document.getElementById("welcomeSubText").textContent = "📍 Your Local Profile is active.";
        document.getElementById("emptyRankMessage").innerHTML = "No Local skill ranks yet.<br>Participate in a Local skill to begin your ranking journey.";
        await loadMyQuickStats();
        await loadNotifications();
        selectBattlefield('local');
        showOnlyStudent();
        return;
    }
    
    if(!profile.inter_rivalry_id){
        const collegeCode = membership.colleges?.college_code || 'XXXX';
        const randomNum = String(Math.floor(1000 + Math.random() * 9000));
        const newRivalryId = `IR-${collegeCode}-${randomNum}`;
        
        await client
            .from("profiles")
            .update({ 
                inter_rivalry_id: newRivalryId
            })
            .eq("id", user.id);
        
        profile.inter_rivalry_id = newRivalryId;
        profile.college_joined = true;
        currentUserProfile = profile;
    }
    
    document.getElementById("rivalryId").textContent = profile.inter_rivalry_id || "Not assigned";
    await loadChessUsername();
    document.getElementById("rivalryId").style.color = "#00d2ff";
    collegeStatus.textContent = "✅ College: " + membership.colleges.college_name + " (" + membership.colleges.college_code + ")";
    collegeStatus.style.color = "#00b894";
    document.getElementById("studentCollegeSection").style.display = "none";
    document.getElementById("welcomeSubText").textContent = "Your rivalry journey starts here.";
    document.getElementById("emptyRankMessage").innerHTML = "No skill ranks yet.<br>Participate in a skill to begin your ranking journey.";
    
    document.getElementById("teamsSection").style.display = "block";
    document.getElementById("teamInvitesSection").style.display = "block";
    document.getElementById("battlefieldSection").style.display = "block";
    document.getElementById("rivalsSectionFull").style.display = "block";
    document.getElementById("actionButtons").style.display = "flex";
    document.getElementById("bottomButtons").style.display = "grid";
    
    // Check if user is admin (super_admin OR college_admin)
    const { data: profileCheck } = await client.from("profiles").select("role").eq("id", user.id).single();
    const isAdmin = profileCheck?.role === "super_admin" || profileCheck?.role === "college_admin";
    
    if (isAdmin) {
        document.getElementById("adminActionButtons").style.display = "flex";
    } else {
        document.getElementById("adminActionButtons").style.display = "none";
    }
    
    await loadMyTeams();
    await loadTeamInvites();
    await loadMyQuickStats();
    await loadNotifications();
    // Login always opens the Local Profile, even for users who also belong to a college.
    selectBattlefield('local');
    showOnlyStudent();
}

// ==================== MOBILE NUMBER (OTP LATER) ====================
async function ensureMobileNumber(userId, forceOpen=false){
    const {data:profile,error}=await client.from('profiles').select('mobile_number').eq('id',userId).single();
    if(error){ console.error('Mobile lookup:',error); return true; }
    const value=String(profile?.mobile_number||'').trim();
    if(value){
        if(forceOpen) openMobileNumberSetup(true);
        return true;
    }
    openMobileNumberSetup(false);
    return false;
}

function openMobileNumberSetup(canClose){
    const modal=document.getElementById('mobileNumberModal'); if(!modal)return;
    modal.dataset.canClose=canClose?'true':'false';
    modal.style.display='flex';
    // This setup is mandatory for users who have not added a number yet.
    modal.onclick=null;
    const input=document.getElementById('mobileNumberInput');
    if(input && currentUserProfile?.mobile_number) input.value=currentUserProfile.mobile_number;
    setTimeout(()=>input?.focus(),100);
}

async function saveMobileNumber(){
    const input=document.getElementById('mobileNumberInput');
    const msg=document.getElementById('mobileNumberMessage');
    const raw=input?.value.trim()||'';
    const digits=raw.replace(/\D/g,'');
    if(digits.length < 10 || digits.length > 15){
        if(msg){msg.style.color='#d63031';msg.textContent='Please enter a valid mobile number.';}
        return;
    }
    const {data:{user}}=await client.auth.getUser(); if(!user)return;
    if(msg){msg.style.color='#777';msg.textContent='Saving mobile number...';}
    const {error}=await client.from('profiles').update({mobile_number:raw,mobile_verified:false}).eq('id',user.id);
    if(error){
        if(msg){msg.style.color='#d63031';msg.textContent='Could not save: '+error.message;}
        return;
    }
    if(currentUserProfile) currentUserProfile.mobile_number=raw, currentUserProfile.mobile_verified=false;
    const modal=document.getElementById('mobileNumberModal'); if(modal)modal.style.display='none';
    await loadStudentDashboardFromCurrentUser();
}

// ==================== LOCAL PROFILE / LOCATION ====================
async function getMyLocalMembership(userId){
    const {data,error}=await client.from('community_memberships')
        .select('id,community_id,status,role,communities(id,type,name,location_area)')
        .eq('user_id',userId).eq('status','approved').eq('communities.type','local').limit(1);
    if(error){ console.error('Local membership lookup:',error); return null; }
    return data?.[0] || null;
}

async function ensureLocalProfile(userId, forceOpen=false){
    const existing=await getMyLocalMembership(userId);
    if(existing?.communities){
        const label=[existing.communities.location_area, existing.communities.name].filter(Boolean).join(', ');
        const el=document.getElementById('localLocationLabel'); if(el) el.textContent=label || 'Local';
        if(forceOpen) openLocalLocationSetup(true);
        return true;
    }
    openLocalLocationSetup(false);
    return false;
}

function openLocalLocationSetup(canClose){
    const modal=document.getElementById('localLocationModal'); if(!modal)return;
    modal.dataset.canClose=canClose?'true':'false';
    modal.style.display='flex';
    const closeAllowed=canClose;
    if(closeAllowed){
        modal.onclick=(e)=>{ if(e.target===modal) modal.style.display='none'; };
    }else modal.onclick=null;
    setTimeout(()=>document.getElementById('localAreaInput')?.focus(),100);
}

async function saveLocalLocation(){
    const state=document.getElementById('localStateInput')?.value.trim() || 'Karnataka';
    const city=document.getElementById('localCityInput')?.value.trim();
    const area=document.getElementById('localAreaInput')?.value.trim();
    const msg=document.getElementById('localLocationMessage');
    if(!city || !area){ if(msg)msg.textContent='Please enter both your city and area/locality.'; return; }
    const {data:{user}}=await client.auth.getUser(); if(!user)return;
    if(msg)msg.style.color='#777',msg.textContent='Setting your Local Profile...';
    const communityName=`${area} Local`;
    let {data:community,error}=await client.from('communities').select('id,name,location_area').eq('type','local').ilike('location_area',area).ilike('name',communityName).limit(1).maybeSingle();
    if(error){ if(msg)msg.style.color='#d63031',msg.textContent=error.message; return; }
    if(!community){
        const created=await client.from('communities').insert({type:'local',name:communityName,location_area:area,created_by:user.id,approval_status:'approved'}).select('id,name,location_area').single();
        if(created.error){ if(msg)msg.style.color='#d63031',msg.textContent='Could not create local area: '+created.error.message; return; }
        community=created.data;
    }
    // First check the EXACT target membership. This prevents a duplicate-key
    // error when the user already has a membership row for this Local community.
    const {data:targetMembership,error:targetMembershipError}=await client.from('community_memberships')
        .select('id,community_id,status,role')
        .eq('community_id',community.id).eq('user_id',user.id).maybeSingle();
    if(targetMembershipError){
        if(msg)msg.style.color='#d63031',msg.textContent='Could not check Local membership: '+targetMembershipError.message;
        return;
    }

    if(targetMembership?.id){
        const updated=await client.from('community_memberships')
            .update({status:'approved',role:targetMembership.role || 'member'})
            .eq('id',targetMembership.id).eq('user_id',user.id);
        if(updated.error){
            if(msg)msg.style.color='#d63031',msg.textContent='Could not activate Local Profile: '+updated.error.message;
            return;
        }
    }else{
        // No row for the target community. Reuse the user's existing Local
        // membership when possible; otherwise create a new one.
        const currentLocal=await getMyLocalMembership(user.id);
        if(currentLocal?.id && currentLocal.community_id !== community.id){
            const moved=await client.from('community_memberships')
                .update({community_id:community.id,status:'approved'})
                .eq('id',currentLocal.id).eq('user_id',user.id);
            if(moved.error){
                if(msg)msg.style.color='#d63031',msg.textContent='Could not change Local Profile: '+moved.error.message;
                return;
            }
        }else{
            const ins=await client.from('community_memberships')
                .insert({community_id:community.id,user_id:user.id,status:'approved',role:'member'});
            if(ins.error){
                if(msg)msg.style.color='#d63031',msg.textContent='Could not activate Local Profile: '+ins.error.message;
                return;
            }
        }
    }
    const {error:profileLocationError}=await client.from('profiles').update({local_state:state,local_city:city,local_area:area,local_community_id:community.id}).eq('id',user.id);
    if(profileLocationError){
        if(msg){msg.style.color='#d63031';msg.textContent='Local membership was set, but saving your location failed. Run the V7.2 Local Tournament Location SQL, then save your location again. Details: '+profileLocationError.message;}
        return;
    }
    const label=document.getElementById('localLocationLabel'); if(label) label.textContent=`${area}, ${city}`;
    const modal=document.getElementById('localLocationModal'); if(modal)modal.style.display='none';
    currentBattlefield='local';
    setBattlefieldButtons('battlefield', 'local');
    renderBattlefieldCards('local');
    const context=document.getElementById('battlefieldContextMessage'); if(context)context.textContent='📍 Local Profile active.';
    if(currentUserProfile) currentUserProfile.local_city=city, currentUserProfile.local_area=area;
    await loadStudentDashboardFromCurrentUser();
}

function returnToLocalProfile(){
    currentBattlefield='local';
    selectBattlefield('local');
    const title=document.getElementById('profileHubTitle');
    const desc=document.getElementById('profileHubDescription');
    const back=document.getElementById('backToLocalProfileBtn');
    if(title) title.textContent='📍 Your Local Profile';
    if(desc) desc.textContent='Your Local Profile is your normal profile. Your location decides your local community and local rankings.';
    if(back) back.style.display='none';
    const actions=document.getElementById('localProfileActions');
    if(actions) actions.scrollIntoView({behavior:'smooth',block:'start'});
}

async function enterCollegeBattlefield(){
    currentBattlefield='college';
    const hubTitle=document.getElementById('profileHubTitle'); if(hubTitle) hubTitle.textContent='🎓 Student Profile';
    const hubDesc=document.getElementById('profileHubDescription'); if(hubDesc) hubDesc.textContent='Your college activities, student details and college rankings are shown here.';
    const backBtn=document.getElementById('backToLocalProfileBtn'); if(backBtn) backBtn.style.display='inline-flex';
    selectBattlefield('college');
    const section=document.getElementById('studentCollegeSection');
    const list=document.getElementById('collegeList');
    const status=document.getElementById('collegeStatus');
    const {data:{user}}=await client.auth.getUser();
    if(!user){ if(section)section.style.display='block'; await loadStudentColleges(); return; }

    // Check the signed-in user's existing active college membership before
    // showing the Join College directory. Do not ask already-joined students to join again.
    const {data:membership,error}=await client
        .from('college_memberships')
        .select('id,college_id,course,year_of_study,specialization,colleges(id,college_name,college_code,city,state)')
        .eq('user_id',user.id)
        .eq('is_active',true)
        .maybeSingle();

    if(error){
        console.warn('College membership check failed:',error);
        if(section)section.style.display='block';
        if(list)list.innerHTML="<div class='empty-box'>Couldn't verify your college membership. Please refresh and try again.</div>";
        return;
    }

    if(membership?.colleges){
        if(section)section.style.display='block';
        // Restore the existing Student Profile team system only for joined college students.
        const teamsSection=document.getElementById('teamsSection');
        const teamInvitesSection=document.getElementById('teamInvitesSection');
        if(teamsSection) teamsSection.style.display='block';
        if(teamInvitesSection) teamInvitesSection.style.display='block';
        await loadMyTeams();
        await loadTeamInvites();
        if(status){
            status.textContent='✅ College: '+membership.colleges.college_name+' ('+membership.colleges.college_code+')';
            status.style.color='#00b894';
        }
        if(list){
            const c=membership.colleges;
            list.innerHTML=`<div class="college-card" style="border:2px solid #00b894;grid-column:1/-1;">
                <h3 style="color:#111;">✅ ${escapeHTML(c.college_name||'Your College')}</h3>
                <div class="college-code">${escapeHTML(c.college_code||'')}</div>
                <div class="college-location">${escapeHTML(c.city||'')}${c.state?', '+escapeHTML(c.state):''}</div>
                <div style="margin-top:10px;color:#00b894;font-weight:800;">YOU'RE ALREADY JOINED</div>
                <div style="margin-top:6px;color:#666;">${escapeHTML(membership.course||'Course not set')}${membership.year_of_study?' • Year '+escapeHTML(String(membership.year_of_study)):''}${membership.specialization?' • '+escapeHTML(membership.specialization):''}</div>
            </div>`;
        }
        return;
    }

    if(section)section.style.display='block';
    const teamsSection=document.getElementById('teamsSection');
    const teamInvitesSection=document.getElementById('teamInvitesSection');
    if(teamsSection) teamsSection.style.display='none';
    if(teamInvitesSection) teamInvitesSection.style.display='none';
    await loadStudentColleges();
}

async function enterGymBattlefield(){
    currentBattlefield='gym';
    const hubTitle=document.getElementById('profileHubTitle'); if(hubTitle) hubTitle.textContent='🏋️ Gym Profile';
    const hubDesc=document.getElementById('profileHubDescription'); if(hubDesc) hubDesc.textContent='Join a gym to unlock your Gym Profile features. Your Local Profile remains separate.';
    const backBtn=document.getElementById('backToLocalProfileBtn'); if(backBtn) backBtn.style.display='inline-flex';
    selectBattlefield('gym');
    document.getElementById('studentCollegeSection')?.style.setProperty('display','none');
    document.getElementById('teamsSection')?.style.setProperty('display','none');
    document.getElementById('teamInvitesSection')?.style.setProperty('display','none');
    const panel=document.getElementById('gymJoinPanel'); if(panel) panel.style.display='block';
    await loadGymMembershipGate();
}

async function loadGymMembershipGate(){
    const list=document.getElementById('availableGymsList');
    const message=document.getElementById('gymMembershipMessage');
    if(!list) return;
    list.innerHTML='<div style="color:#aaa;">Checking your gym membership...</div>';
    if(message) message.textContent='';
    const {data:{user}}=await client.auth.getUser();
    if(!user){list.innerHTML='<div style="color:#f1c40f;">Please sign in to join a gym.</div>';return;}

    // Gym access is based on an approved membership in a gym-type community.
    const {data:memberships,error:memberError}=await client.from('community_memberships')
      .select('id,community_id,status,role,communities(id,type,name,location_area)')
      .eq('user_id',user.id).eq('status','approved');
    if(memberError){
      console.error('Gym membership check failed:',memberError);
      list.innerHTML='<div style="color:#ff7675;">Could not check gym membership. Please refresh and try again.</div>';
      return;
    }
    const activeGym=(memberships||[]).find(m=>String(m.communities?.type||'').toLowerCase()==='gym');
    if(activeGym){
      if(message) message.style.color='#55efc4',message.textContent='✅ You are a member of '+(activeGym.communities.name||'your gym')+'.';
      list.innerHTML='<div style="color:#55efc4;font-weight:800;">Gym membership approved. Your Gym Profile is active.</div>';
      const desc=document.getElementById('profileHubDescription'); if(desc) desc.textContent='Your Gym Profile is active. Fitness and gym features are available to you.';
      if(typeof loadAvailableGyms==='function') await loadAvailableGyms();
      const skillsSection=document.getElementById('battlefieldSection'); if(skillsSection) skillsSection.style.display='block';
      return;
    }

    const pending=(memberships||[]).find(m=>String(m.communities?.type||'').toLowerCase()==='gym' && m.status==='pending');
    if(pending){if(message) message.textContent='⏳ Your request to join '+(pending.communities?.name||'this gym')+' is waiting for approval.';}
    const {data:gyms,error}=await client.from('communities').select('id,name,location_area').eq('type','gym').eq('approval_status','approved').order('name');
    if(error){
      console.error('Available gyms lookup failed:',error);
      list.innerHTML='<div style="color:#ff7675;">Could not load gyms right now. Please try again later.</div>';
      return;
    }
    const gymRows=(gyms||[]).filter(g=>g.id!==pending?.community_id);
    if(!gymRows.length){list.innerHTML='<div style="color:#bbb;">No gyms are available yet. Please check again later.</div>';return;}
    list.innerHTML=gymRows.map(g=>`<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid #333;"><div><strong>${escapeHTML(g.name||'Gym')}</strong><div style="font-size:13px;color:#aaa;">${escapeHTML(g.location_area||'Location not listed')}</div></div><button class="btn-3d-sm-white-glow" style="width:auto;padding:8px 14px;" onclick="requestGymMembership('${String(g.id).replace(/'/g,'')}')">JOIN GYM</button></div>`).join('');
    const skillsSection=document.getElementById('battlefieldSection'); if(skillsSection) skillsSection.style.display='none';
}

async function requestGymMembership(communityId){
    const message=document.getElementById('gymMembershipMessage');
    if(message) message.style.color='#f1c40f',message.textContent='Sending join request...';
    const {data:{user}}=await client.auth.getUser();
    if(!user){if(message) message.textContent='Please sign in first.';return;}
    const {data:existing,error:lookupError}=await client.from('community_memberships').select('id,status').eq('community_id',communityId).eq('user_id',user.id).maybeSingle();
    if(lookupError){if(message) message.style.color='#ff7675',message.textContent='Could not check existing request: '+lookupError.message;return;}
    if(existing){
      if(existing.status==='approved'){await loadGymMembershipGate();return;}
      if(message) message.textContent=existing.status==='pending'?'Your join request is already pending.':'You already have a request for this gym. Contact the gym admin if it was rejected.';
      return;
    }
    const {error}=await client.from('community_memberships').insert({community_id:communityId,user_id:user.id,status:'pending',role:'member'});
    if(error){if(message) message.style.color='#ff7675',message.textContent='Could not send join request: '+error.message;return;}
    if(message) message.textContent='✅ Join request sent. Gym features will unlock after approval.';
    await loadGymMembershipGate();
}


// ==================== STUDENT COLLEGES ====================
async function loadStudentColleges(){
    const list = document.getElementById("collegeList");
    if(!list)return;
    list.innerHTML = "";

    // Guard against other code paths opening the directory for a student who
    // already has an active college membership.
    const {data:{user}}=await client.auth.getUser();
    if(user){
        const {data:existing,error:membershipError}=await client
            .from('college_memberships')
            .select('id,college_id,course,year_of_study,specialization,colleges(id,college_name,college_code,city,state)')
            .eq('user_id',user.id)
            .eq('is_active',true)
            .maybeSingle();
        if(!membershipError && existing?.colleges){
            const c=existing.colleges;
            const status=document.getElementById('collegeStatus');
            if(status){status.textContent='✅ College: '+c.college_name+' ('+c.college_code+')';status.style.color='#00b894';}
            list.innerHTML=`<div class="college-card" style="border:2px solid #00b894;grid-column:1/-1;">
                <h3 style="color:#111;">✅ ${escapeHTML(c.college_name||'Your College')}</h3>
                <div class="college-code">${escapeHTML(c.college_code||'')}</div>
                <div class="college-location">${escapeHTML(c.city||'')}${c.state?', '+escapeHTML(c.state):''}</div>
                <div style="margin-top:10px;color:#00b894;font-weight:800;">YOU'RE ALREADY JOINED</div>
                <div style="margin-top:6px;color:#666;">${escapeHTML(existing.course||'Course not set')}${existing.year_of_study?' • Year '+escapeHTML(String(existing.year_of_study)):''}${existing.specialization?' • '+escapeHTML(existing.specialization):''}</div>
            </div>`;
            return;
        }
    }

    const { data, error } = await client
        .from("colleges")
        .select("id,college_name,college_code,city,state")
        .order("college_name", { ascending: true });
    
    if(error || !data || data.length === 0){
        list.innerHTML = "<div class='empty-box'>No colleges available.</div>";
        return;
    }
    
    data.forEach(college => {
        const card = document.createElement("div");
        card.className = "college-card";
        card.style.borderColor = "#fdcb6e";
        card.style.borderWidth = "2px";
        card.innerHTML = `
            <h3 style="color:#111;">🏛️ ${escapeHTML(college.college_name)}</h3>
            <div class="college-code">${escapeHTML(college.college_code)}</div>
            <div class="college-location">${escapeHTML(college.city || "")}${college.state ? ", " + escapeHTML(college.state) : ""}</div>
            <button class="btn-3d-white-glow-gold" onclick="showJoinForm('${college.id}')" style="margin-top:10px;padding:12px;">
                🎯 JOIN COLLEGE TO GET ID
            </button>
        `;
        list.appendChild(card);
    });
}

// ==================== JOIN COLLEGE ====================
async function showJoinForm(collegeId){
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;padding:20px;backdrop-filter:blur(10px);`;
    const modal = document.createElement('div');
    modal.style.cssText = `background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:40px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;`;
    let selectedCourse = null; let selectedYear = null; let selectedSpecialization = null; let selectedSection = null;
    modal.innerHTML = `
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
        <div id="sectionInputWrap" style="margin-bottom:25px;display:none;">
            <label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">🏷️ Select Section</label>
            <input id="joinSectionInput" type="text" maxlength="20" placeholder="Example: A" style="width:100%;padding:13px;background:#0a0a0a;border:1px solid #333;border-radius:10px;color:white;font-size:16px;text-align:center;text-transform:uppercase;">
            <div style="font-size:12px;color:#666;margin-top:6px;text-align:center;">Section is required for BBA and B.Com. BCA uses specialization instead.</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button id="confirmJoinBtn" class="btn-3d-white-glow" disabled style="opacity:0.5;">⚠️ SELECT ALL</button>
            <button id="cancelJoinBtn" class="btn-3d-sm-white-glow-danger">❌ CANCEL</button>
        </div>
        <div id="joinMessage" style="color:#888;text-align:center;margin-top:12px;"></div>
    `;
    overlay.appendChild(modal); document.body.appendChild(overlay);
    modal.querySelectorAll('.course-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            modal.querySelectorAll('.course-btn').forEach(b => { b.style.opacity='0.5'; b.style.transform='scale(0.95)'; });
            this.style.opacity='1'; this.style.transform='scale(1)';
            selectedCourse = this.dataset.value;
            document.getElementById('selectedCourseDisplay').textContent = '✅ ' + selectedCourse;
            document.getElementById('selectedCourseDisplay').style.color = '#00b894';
            if(selectedCourse === 'BCA') {
                document.getElementById('specializationSection').style.display = 'block';
                document.getElementById('sectionInputWrap').style.display = 'none';
                selectedSection = null;
                const sectionInput = document.getElementById('joinSectionInput');
                if(sectionInput) sectionInput.value = '';
            } else {
                document.getElementById('specializationSection').style.display = 'none';
                selectedSpecialization = null;
                document.getElementById('selectedSpecDisplay').textContent = 'Not needed';
                document.getElementById('selectedSpecDisplay').style.color = '#888';
                document.getElementById('sectionInputWrap').style.display = 'block';
            }
            checkAllSelected();
        });
    });
    modal.querySelectorAll('.year-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            modal.querySelectorAll('.year-btn').forEach(b => { b.style.opacity='0.5'; b.style.transform='scale(0.95)'; });
            this.style.opacity='1'; this.style.transform='scale(1)';
            selectedYear = this.dataset.value;
            const yearText = selectedYear === '1' ? '1st Year' : selectedYear === '2' ? '2nd Year' : '3rd Year';
            document.getElementById('selectedYearDisplay').textContent = '✅ ' + yearText;
            document.getElementById('selectedYearDisplay').style.color = '#00b894';
            checkAllSelected();
        });
    });
    modal.querySelectorAll('.spec-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            modal.querySelectorAll('.spec-btn').forEach(b => { b.style.opacity='0.5'; b.style.transform='scale(0.95)'; });
            this.style.opacity='1'; this.style.transform='scale(1)';
            selectedSpecialization = this.dataset.value;
            document.getElementById('selectedSpecDisplay').textContent = '✅ ' + selectedSpecialization;
            document.getElementById('selectedSpecDisplay').style.color = '#00b894';
            checkAllSelected();
        });
    });
    function checkAllSelected() {
        const confirmBtn = document.getElementById('confirmJoinBtn');
        if(selectedCourse && selectedYear) {
            if(selectedCourse === 'BCA' && !selectedSpecialization) {
                confirmBtn.disabled = true; confirmBtn.textContent = '⚠️ SELECT SPECIALIZATION'; confirmBtn.style.opacity = '0.5'; return;
            }
            if(selectedCourse !== 'BCA') {
                const sectionInput = document.getElementById('joinSectionInput');
                selectedSection = sectionInput ? sectionInput.value.trim().toUpperCase() : '';
                if(!selectedSection) {
                    confirmBtn.disabled = true; confirmBtn.textContent = '⚠️ ENTER SECTION'; confirmBtn.style.opacity = '0.5'; return;
                }
            }
            confirmBtn.disabled = false; confirmBtn.textContent = '✅ CONFIRM & JOIN'; confirmBtn.style.opacity = '1';
        } else {
            confirmBtn.disabled = true; confirmBtn.textContent = '⚠️ SELECT ALL FIELDS'; confirmBtn.style.opacity = '0.5';
        }
    }
    const sectionInput = document.getElementById('joinSectionInput');
    if(sectionInput) sectionInput.addEventListener('input', checkAllSelected);
    document.getElementById('cancelJoinBtn').addEventListener('click', function() { document.body.removeChild(overlay); });
    document.getElementById('confirmJoinBtn').addEventListener('click', async function() {
        const msg = document.getElementById('joinMessage');
        if(!selectedCourse || !selectedYear || (selectedCourse === 'BCA' && !selectedSpecialization) || (selectedCourse !== 'BCA' && !document.getElementById('joinSectionInput')?.value.trim())) { 
            msg.textContent = 'Please select all fields';
            msg.style.color = '#ff6b6b';
            return; 
        }
        this.textContent = '⏳ PROCESSING...'; this.disabled = true;
        const { data: { user } } = await client.auth.getUser();
        if(!user){ alert('Please login first.'); document.body.removeChild(overlay); return; }
        const { error } = await client.from('college_join_requests').insert({
            student_id: user.id,
            college_id: collegeId,
            course: selectedCourse,
            year_of_study: parseInt(selectedYear),
            specialization: selectedSpecialization,
            section: selectedCourse === 'BCA' ? null : document.getElementById('joinSectionInput').value.trim().toUpperCase()
        });
        if(error){ 
            msg.textContent = 'Error: ' + error.message;
            msg.style.color = '#ff6b6b';
            return; 
        }
        msg.textContent = '✅ Join request submitted! Your ID will be assigned after approval.';
        msg.style.color = '#00b894';
        setTimeout(() => {
            document.body.removeChild(overlay);
            loadStudentColleges();
        }, 2000);
    });
    overlay.addEventListener('click', function(e) { if(e.target === overlay) document.body.removeChild(overlay); });
}

// ==================== V5 LOCAL CLUBS + ACTIVITY ====================
function openLocalClubPage(){
    // Local Clubs are intentionally available only from the Local battlefield.
    if(normalizeBattlefield(currentBattlefield)!=='local'){
        currentBattlefield='local';
        selectBattlefield('local');
    }
    hideAll();
    document.getElementById('localClubPage')?.classList.remove('hidden');
    loadLocalClubPage();
}
function openActivityCenter(){
    hideAll();
    document.getElementById('activityCenterPage')?.classList.remove('hidden');
    loadActivityCenter();
}
function localCategoryName(name){
    const c=String(name||'').toLowerCase();
    if(c.includes('football'))return 'Football'; if(c.includes('cricket'))return 'Cricket'; if(c.includes('volleyball'))return 'Volleyball';
    if(c.includes('dance'))return 'Dance'; if(c.includes('sing'))return 'Singing'; if(c.includes('roast'))return 'Roast'; if(c.includes('rap'))return 'Rap';
    if(c.includes('free fire')||c.includes('freefire'))return 'Free Fire'; if(c.includes('pubg')||c.includes('bgmi'))return 'PUBG/BGMI'; if(c.includes('ea sports'))return 'EA Sports';
    if(c.includes('mma'))return 'MMA'; if(c.includes('fitness')||c.includes('workout')||c.includes('strength')||c.includes('push'))return name;
    return name||'Skill';
}
async function loadLocalClubSkillOptions(){
    const select=document.getElementById('localClubSkill'); if(!select)return;
    const {data,error}=await client.from('subcategories').select('id,name,categories(name)').order('name');
    if(error){select.innerHTML='<option value="">Run the new club migration first</option>';return;}
    const eligible=(data||[]).filter(x=>categoryAllowedForBattlefield(x.categories?.name,'local'));
    select.innerHTML='<option value="">Select a Local category / skill</option>'+eligible.map(x=>`<option value="${x.id}">${escapeHTML(localCategoryName(x.name))} • ${escapeHTML(x.name)}</option>`).join('');
}
async function createLocalClub(){
    const name=(document.getElementById('localClubName')?.value||'').trim(); const skillId=document.getElementById('localClubSkill')?.value; const msg=document.getElementById('localClubCreateMessage');
    if(!name||!skillId){if(msg)msg.textContent='Choose a category/skill and enter a club name.';return;}
    const {data:{user}}=await client.auth.getUser(); if(!user){if(msg)msg.textContent='Please login first.';return;}
    const {data,error}=await client.from('local_clubs').insert({name,subcategory_id:skillId,created_by:user.id}).select('id').single();
    if(error){if(msg)msg.textContent='Could not create club: '+error.message;return;}
    await client.from('local_club_members').insert({club_id:data.id,user_id:user.id,role:'captain',status:'active'});
    if(msg)msg.textContent='✅ Club created.'; document.getElementById('localClubName').value=''; await loadLocalClubs();
}
async function loadLocalClubPage(){await loadLocalClubSkillOptions();await loadLocalClubs();await loadLocalClubInvites();}
async function loadLocalClubs(){
    const box=document.getElementById('myLocalClubsList'); if(!box)return; const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data,error}=await client.from('local_club_members').select('club_id,role,status,local_clubs(id,name,created_by,subcategory_id,subcategories(name,categories(name)))').eq('user_id',user.id).eq('status','active');
    if(error){box.innerHTML=`<div class="empty-box">Clubs are not configured yet. Run the new SQL migration first.</div>`;return;}
    if(!data?.length){box.innerHTML='<div class="empty-box">You are not in a Local club yet.</div>';return;}
    box.innerHTML=data.map(m=>{const c=m.local_clubs||{};return `<div class="local-club-card"><h3>🏟️ ${escapeHTML(c.name||'Club')}</h3><div class="club-meta">Category: ${escapeHTML(localCategoryName(c.subcategories?.name||'Skill'))}<br>Role: ${escapeHTML(m.role||'member')}</div><div class="club-actions"><button class="btn-3d-sm-white-glow" style="width:auto;padding:7px 14px;" onclick="loadLocalClubDashboard('${c.id}')">📊 DASHBOARD</button>${m.role==='captain'?`<button class="btn-3d-sm-white-glow" style="width:auto;padding:7px 14px;" onclick="promptLocalClubInvite('${c.id}')">📨 INVITE</button>`:''}</div></div>`}).join('');
}
async function promptLocalClubInvite(clubId){
    const rivalryId=(prompt("Enter the player's INTER RIVALRY ID (example: IR-XXXX-XXXX):")||'').trim(); if(!rivalryId)return;
    const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data:target}=await client.from('profiles').select('id,full_name,inter_rivalry_id').eq('inter_rivalry_id',rivalryId).maybeSingle();
    if(!target)return alert('Player not found. Check the INTER RIVALRY ID.');
    if(target.id===user.id)return alert('You cannot invite yourself.');
    const {data:club}=await client.from('local_clubs').select('id,subcategory_id,subcategories(name,categories(name))').eq('id',clubId).maybeSingle();
    if(!club)return alert('Club not found.');
    const {data:errorData,error:memberCheckError}=await client.from('local_club_members').select('id').eq('club_id',clubId).eq('user_id',target.id).eq('status','active').maybeSingle();
    if(memberCheckError)return alert('Could not check club membership: '+memberCheckError.message);
    if(errorData)return alert('That player is already in the club.');
    const {data,error}=await client.from('local_club_invites').insert({club_id:clubId,inviter_id:user.id,invitee_id:target.id,status:'pending'}).select('id').single();
    alert(error?'Could not send invite: '+error.message:`✅ ${target.full_name||'Player'} invited to the ${club.subcategories?.name||'selected'} club.`);
    if(!error) await writeActivity(target.id,'club_invite','🏟️ Club Invite',`You received a Local ${club.subcategories?.name||'skill'} club invite.`);
}
async function loadLocalClubInvites(){
    const box=document.getElementById('localClubInvitesList'); if(!box)return; const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data,error}=await client.from('local_club_invites').select('id,club_id,inviter_id,created_at,local_clubs(name,subcategory_id,subcategories(name,categories(name)))').eq('invitee_id',user.id).eq('status','pending').order('created_at',{ascending:false});
    if(error){box.innerHTML='<div class="empty-box">No club invites available yet.</div>';return;}
    if(!data?.length){box.innerHTML='<div class="empty-box">No pending club invites.</div>';return;}
    box.innerHTML=data.map(i=>`<div class="local-club-card"><h3>📨 ${escapeHTML(i.local_clubs?.name||'Club')}</h3><div class="club-meta">Category: ${escapeHTML(localCategoryName(i.local_clubs?.subcategories?.name||'Skill'))}</div><div class="club-actions"><button class="btn-3d-sm-white-glow" style="width:auto;padding:7px 14px;" onclick="respondLocalClubInvite('${i.id}','accepted')">✅ ACCEPT</button><button class="btn-3d-sm-white-glow-danger" style="width:auto;padding:7px 14px;" onclick="respondLocalClubInvite('${i.id}','declined')">❌ DECLINE</button></div></div>`).join('');
}
async function respondLocalClubInvite(inviteId,status){
    const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data:inv,error}=await client.from('local_club_invites').select('club_id').eq('id',inviteId).eq('invitee_id',user.id).eq('status','pending').maybeSingle(); if(error||!inv)return;
    if(status==='accepted'){const {error:e}=await client.from('local_club_members').insert({club_id:inv.club_id,user_id:user.id,role:'member',status:'active'});if(e)return alert('Could not join club: '+e.message);}
    await client.from('local_club_invites').update({status}).eq('id',inviteId).eq('invitee_id',user.id);
    await loadLocalClubInvites();await loadLocalClubs();
}
async function loadLocalClubDashboard(clubId){
    const {data:{user}}=await client.auth.getUser();
    const box=document.getElementById('localClubDashboard'); if(!box)return;
    const {data:club,error}=await client.from('local_clubs').select('id,name,created_by,subcategory_id,subcategories(name,categories(name))').eq('id',clubId).maybeSingle();
    if(error||!club){box.innerHTML='<div class="empty-box">Could not load club dashboard.</div>';return;}
    // Fetch memberships and profiles separately so a missing/ambiguous PostgREST relationship
    // cannot make an active club look like it has zero members.
    const {data:memberRows,error:memberErr}=await client.from('local_club_members').select('user_id,role,status').eq('club_id',clubId).eq('status','active');
    if(memberErr){box.innerHTML=`<div class="empty-box">Could not load club members: ${escapeHTML(memberErr.message)}</div>`;return;}
    const members=memberRows||[];
    const memberIds=[...new Set(members.map(m=>m.user_id).filter(Boolean))];
    let profileMap={};
    if(memberIds.length){const {data:profiles,error:profileErr}=await client.from('profiles').select('id,full_name,inter_rivalry_id').in('id',memberIds);if(profileErr){console.warn('Club member profiles:',profileErr.message);}else profileMap=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));}
    members.forEach(m=>m.profile=profileMap[m.user_id]||{});
    const myMembership=members.find(x=>x.user_id===user?.id);
    const captain=members.find(x=>x.role==='captain');
    box.innerHTML=`<div class="local-club-card"><h3>🏟️ ${escapeHTML(club.name)}</h3><div class="club-meta">Category: ${escapeHTML(localCategoryName(club.subcategories?.name||'Skill'))}<br>Members: ${members.length}<br>Captain: ${escapeHTML(captain?.profile?.full_name||'-')}</div>${myMembership?.role==='captain'?`<button class="btn-3d-white-glow-gold" style="margin-top:12px;width:auto;padding:10px 18px;" onclick="promptLocalClubChallenge('${club.id}')">⚔️ CHALLENGE ANOTHER CLUB</button>`:''}<h4 style="margin-top:15px;color:#fff;">👥 Members (${members.length})</h4>${members.length?members.map(m=>`<div class="club-member-row" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;"><span><strong>${escapeHTML(m.profile?.full_name||'Player')}</strong><br><small style="color:#888;">${escapeHTML(m.profile?.inter_rivalry_id||'IR ID unavailable')}</small><br><small style="color:#888;">${escapeHTML(m.role||'member')}</small></span><button class="btn-3d-sm-white-glow" style="width:auto;padding:5px 10px;font-size:11px;" onclick="viewProfile('${m.user_id}')">👤 VIEW PROFILE</button></div>`).join(''):'<div class="empty-box">No active members found. If you recently accepted an invite, refresh or check the club membership status.</div>'}</div>`;
}
async function promptLocalClubChallenge(clubId){
    const {data:{user}}=await client.auth.getUser(); if(!user)return alert('Please login first.');
    const scope=await getBattlefieldMemberIds('local',user.id);
    const {data:mine,error:mineErr}=await client.from('local_clubs').select('id,name,subcategory_id,subcategories(name,categories(name))').eq('id',clubId).maybeSingle();
    if(mineErr||!mine)return alert('Could not load your club.');
    const {data:myCaptain,error:captErr}=await client.from('local_club_members').select('role,status').eq('club_id',clubId).eq('user_id',user.id).eq('status','active').maybeSingle();
    if(captErr||myCaptain?.role!=='captain')return alert('Only your club captain can send a club challenge.');
    const {data:clubs,error}=await client.from('local_clubs').select('id,name,subcategory_id').eq('is_active',true).eq('subcategory_id',mine.subcategory_id).neq('id',clubId).order('name');
    if(error)return alert('Could not load rival clubs: '+error.message);
    const eligible=[];
    for(const c of (clubs||[])){
      const {data:ms}=await client.from('local_club_members').select('user_id,role,status,profiles(id,full_name,inter_rivalry_id)').eq('club_id',c.id).eq('status','active');
      const captain=(ms||[]).find(m=>m.role==='captain' && scope.ids.includes(m.user_id));
      if(captain) eligible.push({club:c,members:ms||[],captain});
    }
    if(!eligible.length)return alert('No rival club in your Local battlefield was found for this skill. Another club must have an active captain in your Local community.');
    const menu=eligible.map((x,i)=>`${i+1}. ${x.club.name} (${x.members.length} players)`).join('\n');
    const answer=prompt(`Choose a rival club to challenge:\n\n${menu}\n\nEnter the club number:`);
    if(answer===null)return; const chosen=eligible[Number(answer)-1]; if(!chosen)return alert('Invalid club number.');
    const title=(prompt('Challenge title:',`${mine.subcategories?.name||'Sports'}: ${mine.name} vs ${chosen.club.name}`)||'').trim(); if(!title)return;
    const start=new Date(Date.now()+60*60*1000), end=new Date(Date.now()+2*60*60*1000);
    const fmt=d=>{const pad=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;};
    const startInput=prompt('Start time (YYYY-MM-DDTHH:MM):',fmt(start)); if(!startInput)return;
    const endInput=prompt('End time (YYYY-MM-DDTHH:MM):',fmt(end)); if(!endInput)return;
    const startDate=new Date(startInput),endDate=new Date(endInput); if(isNaN(startDate)||isNaN(endDate)||endDate<=startDate)return alert('Invalid time range. End must be after start.');
    const teamA=(await client.from('local_club_members').select('user_id,profiles(id,full_name,inter_rivalry_id)').eq('club_id',clubId).eq('status','active')).data||[];
    const teamB=chosen.members;
    if(!teamA.some(m=>m.user_id===user.id)||!teamB.some(m=>m.user_id===chosen.captain.user_id))return alert('Could not verify the club rosters.');
    const {data:challenge,error:insertError}=await client.from('challenges').insert({
      challenger_id:user.id,opponent_id:chosen.captain.user_id,subcategory_id:mine.subcategory_id,title,description:`Local club challenge: ${mine.name} vs ${chosen.club.name}`,
      starts_at:startDate.toISOString(),ends_at:endDate.toISOString(),status:'pending',mode:'team',battlefield_type:'local',community_id:scope.communityId||null,
      rules:{game:'manual_report',result_source:'manual_report',result_status:'awaiting_match',team_challenge:true,team_challenge_type:'club_vs_club',club_challenge:true,club_a_id:clubId,club_a_name:mine.name,club_b_id:chosen.club.id,club_b_name:chosen.club.name,team_name:mine.name,opponent_team_name:chosen.club.name,team_a_captain_id:user.id,team_b_captain_id:chosen.captain.user_id,team_a_members:teamA.map(m=>({id:m.user_id,full_name:m.profiles?.full_name||'Player',inter_rivalry_id:m.profiles?.inter_rivalry_id||''})),team_b_members:teamB.map(m=>({id:m.user_id,full_name:m.profiles?.full_name||'Player',inter_rivalry_id:m.profiles?.inter_rivalry_id||''}))}
    }).select('id').single();
    if(insertError)return alert('Could not send club challenge: '+insertError.message);
    await writeActivity(chosen.captain.user_id,'club_challenge','⚔️ Club Challenge',`${mine.name} challenged your club ${chosen.club.name} in ${mine.subcategories?.name||'a skill'}.`);
    alert(`⚔️ Club challenge sent to ${chosen.club.name}! Their captain can accept it in My Challenges.`);
}

async function writeActivity(userId,type,title,message){
    try{await client.from('activity_events').insert({user_id:userId,type,title,message});}catch(e){console.warn('Activity write unavailable',e);}
}
async function loadActivityCenter(){
    const box=document.getElementById('activityCenterList'); if(!box)return; const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data,error}=await client.from('activity_events').select('id,type,title,message,created_at,read_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(50);
    if(error){box.innerHTML='<div class="empty-box">Activity Center needs the new SQL migration.</div>';return;}
    if(!data?.length){box.innerHTML='<div class="empty-box">No activity yet.</div>';return;}
    box.innerHTML=data.map(a=>`<div class="activity-item"><h4>${escapeHTML(a.title||'Activity')}</h4><div>${escapeHTML(a.message||'')}</div><div class="activity-meta">${escapeHTML(a.type||'activity')} • ${formatDate(a.created_at)}</div></div>`).join('');
    await client.from('activity_events').update({read_at:new Date().toISOString()}).eq('user_id',user.id).is('read_at',null);
}
async function loadActivityPreview(){
    const box=document.getElementById('activityCenterPreview'); if(!box)return; const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data,error}=await client.from('activity_events').select('title,message,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).limit(3);
    if(error||!data?.length){box.innerHTML='<div class="empty-box">No new activity.</div>';return;}
    box.innerHTML=data.map(a=>`<div class="activity-item"><h4>${escapeHTML(a.title||'Activity')}</h4><div>${escapeHTML(a.message||'')}</div><div class="activity-meta">${formatDate(a.created_at)}</div></div>`).join('');
}

// ==================== BATTLEFIELD SCOPE SECURITY ====================
// IMPORTANT: Every competitive view must be scoped to the active battlefield.
// College uses the approved legacy college_memberships table. Gym/Local use
// community_memberships when those battlefields are selected. These helpers
// prevent cross-college users from being mixed into rivals/rankings/challenges.
async function getActiveCollegeScope(userId = null){
    const uid = userId || (await client.auth.getUser()).data.user?.id;
    if(!uid) return null;
    const { data, error } = await client
        .from('college_memberships')
        .select('id,user_id,college_id,course,year_of_study,specialization,is_active,colleges(id,college_name,college_code)')
        .eq('user_id', uid)
        .eq('is_active', true)
        .maybeSingle();
    if(error) throw error;
    return data || null;
}

async function getActiveCommunityScope(userId = null, type = null){
    const uid = userId || (await client.auth.getUser()).data.user?.id;
    if(!uid) return null;
    let q = client
        .from('community_memberships')
        .select('id,user_id,community_id,status,role,communities(id,type,name,location_area)')
        .eq('user_id', uid)
        .eq('status', 'approved');
    if(type) q = q.eq('communities.type', normalizeBattlefield(type));
    const { data, error } = await q;
    if(error) throw error;
    return (data || [])[0] || null;
}

async function getBattlefieldMemberIds(battlefield, userId = null){
    const b = normalizeBattlefield(battlefield);
    const uid = userId || (await client.auth.getUser()).data.user?.id;
    if(!uid) return { ids: [], communityId: null, collegeId: null };

    if(b === 'college'){
        const me = await getActiveCollegeScope(uid);
        if(!me) return { ids: [], communityId: null, collegeId: null, membership: null };
        const { data, error } = await client
            .from('college_memberships')
            .select('user_id')
            .eq('college_id', me.college_id)
            .eq('is_active', true);
        if(error) throw error;
        return {
            ids: [...new Set((data || []).map(x => x.user_id).filter(Boolean))],
            communityId: null,
            collegeId: me.college_id,
            membership: me
        };
    }

    const me = await getActiveCommunityScope(uid, b);
    if(!me) return { ids: [], communityId: null, collegeId: null, membership: null };
    const { data, error } = await client
        .from('community_memberships')
        .select('user_id')
        .eq('community_id', me.community_id)
        .eq('status', 'approved');
    if(error) throw error;
    return {
        ids: [...new Set((data || []).map(x => x.user_id).filter(Boolean))],
        communityId: me.community_id,
        collegeId: null,
        membership: me
    };
}

async function canInteractWithOpponent(userId, opponentId, battlefield = currentBattlefield){
    const b = normalizeBattlefield(battlefield);
    // Local is a global social/challenge space: Local users can view and challenge
    // any registered INTER RIVALRY user, regardless of community/location.
    // College and Gym remain isolated to their own approved membership pools.
    if(b === 'local') return userId !== opponentId;
    const scope = await getBattlefieldMemberIds(b, userId);
    return !!scope.ids.includes(opponentId);
}

// Strictly isolate challenge history by the active profile. Legacy untagged
// challenges are treated as College records, never Local/Gym records.
function challengeBelongsToBattlefield(row, battlefield, communityId = null, collegeId = null){
    const b = normalizeBattlefield(battlefield || 'local');
    if(!row) return false;

    // Older challenges without a battlefield tag belong to College only.
    if(!row.battlefield_type) return b === 'college';

    const rowBattlefield = normalizeBattlefield(row.battlefield_type);
    if(rowBattlefield !== b) return false;

    // Local challenges are global; they do not belong to a college/gym community.
    if(b === 'local') return true;

    // College challenges are scoped to the specific college, not every college.
    // New rows store the college ID in rules.college_id because the legacy
    // community_id column is used for Local/Gym communities.
    if(b === 'college'){
        const rowCollegeId = row.rules?.college_id || null;
        if(rowCollegeId && collegeId) return rowCollegeId === collegeId;
        // Keep older untagged college rows visible for backward compatibility.
        return !rowCollegeId;
    }

    // Gym challenges must match the active gym community.
    if(b === 'gym'){
        return !!communityId && !!row.community_id && row.community_id === communityId;
    }

    return false;
}

async function getCurrentBattlefieldScope(userId){
    const b = normalizeBattlefield(currentBattlefield || 'local');
    const scope = await getBattlefieldMemberIds(b, userId);
    return { battlefield:b, communityId:scope.communityId || null, collegeId:scope.collegeId || null, ids:new Set(scope.ids || []) };
}

// ==================== VIEW PROFILE ====================
async function viewProfile(userId){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ alert('Please login first.'); return; }
    if(user.id === userId){ selectedProfileId = userId; }
    const battlefield = normalizeBattlefield(currentBattlefield || 'local');
    try{
        if(!(await canInteractWithOpponent(user.id, userId, battlefield)) && user.id !== userId){
            alert(`⚠️ This user is outside your ${battlefield} battlefield.`);
            return;
        }
    }catch(err){
        console.error(err);
        alert('Could not verify battlefield membership.');
        return;
    }
    selectedProfileId = userId;
    const { data: profile, error } = await client.from('profiles').select('id,full_name,inter_rivalry_id,role').eq('id',userId).single();
    if(error || !profile){ alert('Unable to load profile.'); return; }
    document.getElementById('viewProfileName').textContent = profile.full_name || 'User';
    document.getElementById('viewProfileRivalry').textContent = profile.inter_rivalry_id || '-';
    let membership = null;
    if(battlefield === 'college'){
        const { data } = await client.from('college_memberships').select('course,year_of_study,specialization,colleges(college_name)').eq('user_id',userId).eq('is_active',true).maybeSingle();
        membership = data;
    }else{
        const { data } = await client.from('community_memberships').select('communities(name,location_area)').eq('user_id',userId).eq('status','approved').eq('communities.type',battlefield).maybeSingle();
        membership = data;
    }
    document.getElementById('viewProfileCollege').textContent = battlefield === 'college'
        ? ((membership && membership.colleges) ? membership.colleges.college_name : 'College info unavailable')
        : ((membership && membership.communities) ? membership.communities.name : `${battlefield} info unavailable`);
    const skillsBox = document.getElementById('viewProfileSkills');
    skillsBox.innerHTML = "<div class='empty-box'>Loading skills...</div>";
    const { data: skills } = await client.from('participations').select('subcategory_id,subcategories(id,name,categories(name))').eq('user_id',userId);
    if(!skills || skills.length === 0){ skillsBox.innerHTML = "<div class='empty-box'>No skills yet.</div>"; } else {
        skillsBox.innerHTML = '';
        skills.forEach(row => {
            const skill = row.subcategories;
            if(!skill) return;
            const item = document.createElement('div');
            item.className = 'skill-item';
            item.innerHTML = `<strong>${escapeHTML(skill.name)}</strong><div style="color:#777;margin-top:5px">${escapeHTML(skill.categories ? skill.categories.name : 'Skill')}</div>`;
            skillsBox.appendChild(item);
        });
    }
    const { data: profileChallenges } = await client.from('challenges').select('id,challenger_id,opponent_id,status,rules,battlefield_type,community_id').or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`);
    const scopedChallenges = (profileChallenges || []).filter(c => {
        if(c.battlefield_type) return normalizeBattlefield(c.battlefield_type) === battlefield && (battlefield !== 'college' || !c.community_id || c.community_id === (membership?.community_id || null));
        return battlefield === 'college';
    });
    const completed = scopedChallenges.filter(c => c.status === 'completed');
    const wins = completed.filter(c => c.rules?.winner_id === userId).length;
    const losses = completed.filter(c => c.rules?.winner_id && c.rules.winner_id !== userId && c.rules.result !== 'draw').length;
    const draws = completed.filter(c => c.rules?.result === 'draw').length;
    document.getElementById('viewProfileStats').innerHTML = `<div class="stat-grid"><div class="rival-stat"><div class="num">${wins}</div><div class="lbl">Wins</div></div><div class="rival-stat"><div class="num">${losses}</div><div class="lbl">Losses</div></div><div class="rival-stat"><div class="num">${draws}</div><div class="lbl">Draws</div></div></div>`;
    const interests = [...(skills||[])].map(x => x.subcategories?.name).filter(Boolean);
    document.getElementById('viewProfileInterests').innerHTML = interests.length ? `<h2 style="margin-bottom:10px">🎯 Interests</h2><div>${interests.map(x => `<span class="category-tag">${escapeHTML(x)}</span>`).join('')}</div>` : '';
    showOnlyProfile();
}

// ==================== OPEN CHALLENGE ====================
async function openChallengePage(){
    if(!selectedProfileId){ alert("No opponent selected."); return; }
    const { data: { user } } = await client.auth.getUser();
    if(!user){ alert("Please login first."); return; }
    if(user.id === selectedProfileId){ alert("You cannot challenge yourself."); return; }
    if(!(await canInteractWithOpponent(user.id, selectedProfileId, currentChallengeBattlefield || currentBattlefield || 'local'))){
        alert(`⚠️ Opponent is not in your ${normalizeBattlefield(currentChallengeBattlefield || currentBattlefield)} battlefield.`);
        return;
    }
    const { data: opponent } = await client.from("profiles").select("full_name,inter_rivalry_id").eq("id",selectedProfileId).single();
    if(!opponent){ alert("Opponent not found."); return; }
    document.getElementById("challengeOpponentName").textContent = opponent.full_name || "User";
    document.getElementById("challengeOpponentId").textContent = opponent.inter_rivalry_id || "-";
    currentChallengeBattlefield = currentBattlefield || 'local';
    setBattlefieldButtons('challengeBattlefield',currentChallengeBattlefield);
    await loadChallengeSkills();
    showOnlyChallenge();
}

let currentBattlefield = 'local';
let currentChallengeBattlefield = 'local';
const LOCAL_ALLOWED_CATEGORIES = ['sports','culture','gaming','mma','fitness','workout'];
const COLLEGE_ALLOWED_CATEGORIES = ['sports','education','culture','gaming','technology','mma'];
const GYM_ALLOWED_CATEGORIES = ['fitness','workout'];

function normalizeBattlefield(v){ return String(v||'local').toLowerCase().trim(); }
function categoryAllowedForBattlefield(category, battlefield){
    const c = String(category||'').toLowerCase().trim();
    const b = normalizeBattlefield(battlefield);
    if(b === 'local') return LOCAL_ALLOWED_CATEGORIES.some(x => c.includes(x));
    if(b === 'gym') return GYM_ALLOWED_CATEGORIES.some(x => c.includes(x));
    return COLLEGE_ALLOWED_CATEGORIES.some(x => c.includes(x));
}
function setBattlefieldButtons(prefix, battlefield){
    const map={local:`${prefix}Local`,college:`${prefix}College`,gym:`${prefix}Gym`};
    Object.entries(map).forEach(([k,id])=>document.getElementById(id)?.classList.toggle('active',k===battlefield));
}
function selectBattlefield(battlefield){
    currentBattlefield=normalizeBattlefield(battlefield);
    // Never reuse a rival list from another battlefield/community.
    rivalsLoaded = false;
    allRivalsData = [];
    const rivalInput=document.getElementById('rivalSearchInput'); if(rivalInput) rivalInput.value='';
    const rivalList=document.getElementById('rivalsList'); if(rivalList) rivalList.innerHTML="<div class='empty-box'>Search by name or IR ID to find rivals.</div>";
    setBattlefieldButtons('battlefield',currentBattlefield);
    const msg=document.getElementById('battlefieldContextMessage');
    if(msg) msg.textContent=currentBattlefield==='local'?'📍 Local Profile active.':currentBattlefield==='college'?'🎓 Student Profile / College battlefield active.':'🏋️ Gym Profile / Gym battlefield active.';
    renderBattlefieldCards(currentBattlefield);

    // Clubs belong ONLY to the Local battlefield. They must never appear as
    // a College or Gym feature.
    const clubBtn=document.getElementById('localClubActionButton');
    if(clubBtn) clubBtn.style.display = currentBattlefield==='local' ? 'none' : 'none';
    const localActions=document.getElementById('localProfileActions');
    const standardActions=document.getElementById('actionButtons');
    const bottomButtons=document.getElementById('bottomButtons');
    const quickStats=document.getElementById('myQuickStats');
    const teams=document.getElementById('teamsSection');
    const teamInvites=document.getElementById('teamInvitesSection');
    const activity=document.getElementById('activityCenterCard');
    const battlefieldHub=document.getElementById('battlefieldHubCard');
    if(currentBattlefield==='local'){
        if(localActions) localActions.style.display='grid';
        // Local Profile has its own compact menu. Hide College-only class/admin/join controls.
        const localCollegeSection=document.getElementById('studentCollegeSection');
        if(localCollegeSection) localCollegeSection.style.display='none';
        const localAdminButtons=document.getElementById('adminActionButtons');
        if(localAdminButtons) localAdminButtons.style.display='none';
        const localClassButton=[...document.querySelectorAll('button')].find(b=>/MY CLS|MY CLASS/i.test(b.textContent||''));
        if(localClassButton) localClassButton.style.display='none';
        if(standardActions) standardActions.style.display='none';
        if(bottomButtons) bottomButtons.style.display='none';
        if(quickStats) quickStats.style.display='none';
        if(teams) teams.style.display='none';
        if(teamInvites) teamInvites.style.display='none';
        if(activity) activity.style.display='none';
        if(battlefieldHub) battlefieldHub.style.display='';
        const statusCard=document.getElementById('collegeStatus')?.closest('.profile-card'); if(statusCard) statusCard.style.display='none';
        document.getElementById('studentCollegeSection')?.style.setProperty('display','none');
        const skillsSection=document.getElementById('battlefieldSection'); if(skillsSection) skillsSection.style.display='none';
    } else {
        if(localActions) localActions.style.display='none';
        if(standardActions) standardActions.style.display='flex';
        if(bottomButtons) bottomButtons.style.display='grid';
        if(quickStats) quickStats.style.display='';
        if(activity) activity.style.display='';
        if(battlefieldHub) battlefieldHub.style.display='';
        const statusCard=document.getElementById('collegeStatus')?.closest('.profile-card'); if(statusCard) statusCard.style.display='';
        const skillsSection=document.getElementById('battlefieldSection'); if(skillsSection) skillsSection.style.display='block';
        if(currentBattlefield==='college') {
            document.getElementById('studentCollegeSection')?.style.removeProperty('display');
            const classButton=[...document.querySelectorAll('button')].find(b=>/MY CLS|MY CLASS/i.test(b.textContent||''));
            if(classButton) classButton.style.display='';
            // Team creation, team rosters, and team invites are College/Student Profile features.
            // Keep their original sections and functions; visibility is enabled after membership is confirmed.
        } else {
            document.getElementById('studentCollegeSection')?.style.setProperty('display','none');
            if(teams) teams.style.display='none';
            if(teamInvites) teamInvites.style.display='none';
        }
        const gymPanel=document.getElementById('gymJoinPanel');
        if(gymPanel) gymPanel.style.display=currentBattlefield==='gym'?'block':'none';
    }
}
function renderBattlefieldCards(battlefield){
    const box=document.getElementById('battlefieldCategoryCards'); if(!box)return;
    const b=normalizeBattlefield(battlefield);
    const cards=b==='local'?[
      ['🏏','Sports','Cricket • Football • Volleyball'],['🎭','Culture','Dance • Singing • Roast • Rap'],['🎮','Gaming','Free Fire • PUBG/BGMI • EA Sports'],['🥊','MMA','MMA'],['🏋️','Fitness','Workout / Fitness']
    ]:b==='gym'?[['🏋️','Fitness','Workout / Fitness challenges']]:[
      ['🏏','Sports','Cricket • Football • Volleyball'],['🎓','Education','BCA • B.Com • BBA'],['🎭','Culture','Dance • Singing • Roast • Rap'],['🎮','Gaming','Free Fire • PUBG/BGMI • EA Sports'],['💻','Technology','Coding • Web Development Quiz'],['🥊','MMA','MMA']
    ];
    box.innerHTML=cards.map(x=>`<div class="category-card"><div class="category-icon">${x[0]}</div><h3>${x[1]}</h3><p>${x[2]}</p></div>`).join('');
}
function setChallengeBattlefield(battlefield){
    currentChallengeBattlefield=normalizeBattlefield(battlefield);
    setBattlefieldButtons('challengeBattlefield',currentChallengeBattlefield);
    const msg=document.getElementById('challengeBattlefieldMessage');
    const rule=document.getElementById('challengeSkillRule');
    if(msg) msg.textContent=currentChallengeBattlefield==='local'?'📍 Local: Sports, Culture, Gaming, MMA and Fitness.':currentChallengeBattlefield==='gym'?'🏋️ Gym: Fitness / Workout skills only.':'🎓 College: all College-allowed skills including Education and Technology.';
    if(rule) rule.textContent=msg?.textContent||'';
    loadChallengeSkills();
}

async function loadChallengeSkills(){
    const select = document.getElementById("challengeSkill");
    select.innerHTML = "<option value=''>Loading skills...</option>";
    const { data, error } = await client.from("subcategories").select("id,name,categories(name)").order("name");
    if(error || !data || data.length === 0){ 
        select.innerHTML = "<option value=''>No skills available</option>"; 
        return; 
    }
    select.innerHTML = "<option value=''>Select a skill</option>";
    data.filter(skill => categoryAllowedForBattlefield(skill.categories?.name, currentChallengeBattlefield)).forEach(skill => {
        const option = document.createElement("option");
        const categoryName = skill.categories?.name || "";
        option.value = skill.id;
        option.dataset.skillName = skill.name || "";
        option.dataset.categoryName = categoryName;
        option.textContent = categoryName ? categoryName + " • " + skill.name : skill.name;
        select.appendChild(option);
    });
    handleChallengeSkillChange();
}

// ==================== CHALLENGE MODE ====================
function setChallengeMode(mode){
    const skillMeta = getSelectedChallengeSkillMeta();
    if(mode !== 'solo' && skillMeta && !isSportsChallengeSkill(skillMeta)){
        const message=document.getElementById('challengeMessage');
        if(message) message.textContent='👥 Shuffle and Team vs Team modes are available for Sports challenges. Use SOLO for this skill.';
        selectedChallengeMode='solo';
    } else {
        selectedChallengeMode = ['team','team_vs_team'].includes(mode) ? mode : 'solo';
    }
    document.getElementById('soloModeBtn')?.classList.toggle('active', selectedChallengeMode==='solo');
    document.getElementById('teamModeBtn')?.classList.toggle('active', selectedChallengeMode==='team');
    document.getElementById('teamVsTeamModeBtn')?.classList.toggle('active', selectedChallengeMode==='team_vs_team');
    const fields=document.getElementById('teamChallengeFields');
    if(fields) fields.style.display=selectedChallengeMode==='solo'?'none':'grid';
    const opponentField=document.getElementById('opponentTeamField');
    if(opponentField) opponentField.style.display=selectedChallengeMode==='team_vs_team'?'block':'none';
    const help=document.getElementById('teamChallengeHelp');
    if(help) help.textContent=selectedChallengeMode==='team_vs_team'
      ? 'Team vs Team: choose one of your teams and a team that includes your opponent. Each full roster competes together.'
      : 'Shuffle mode: both captains must belong to the selected roster. Players are randomly split into balanced teams.';
    if(selectedChallengeMode!=='solo') loadMyChallengeTeams();
}

async function loadMyChallengeTeams(){
    const select = document.getElementById("challengeMyTeam");
    if(!select) return;
    select.innerHTML = "<option value=''>Loading...</option>";
    const { data: { user } } = await client.auth.getUser();
    if(!user){ select.innerHTML = "<option value=''>Please login</option>"; return; }

    const { data: members, error } = await client
        .from("team_members")
        .select("team_id,teams(id,name,college_id,captain_id)")
        .eq("user_id", user.id);

    if(error || !members || members.length === 0){
        select.innerHTML = "<option value=''>No teams found</option>";
        return;
    }

    const teams = (members || []).map(x => x.teams).filter(Boolean);
    select.innerHTML = "<option value=''>Select your team</option>";
    teams.forEach(team => { const o=document.createElement('option'); o.value=team.id; o.textContent=team.name; select.appendChild(o); });
    const opponentSelect=document.getElementById('challengeOpponentTeam');
    if(opponentSelect){
      opponentSelect.innerHTML="<option value=''>Loading opponent teams...</option>";
      const {data:opponentMembers,error:opErr}=await client.from('team_members').select('team_id,teams(id,name,captain_id)').eq('user_id',selectedProfileId);
      const opponentTeams=(opponentMembers||[]).map(x=>x.teams).filter(Boolean);
      opponentSelect.innerHTML="<option value=''>Select opponent's team</option>";
      opponentTeams.forEach(team=>{const o=document.createElement('option');o.value=team.id;o.textContent=team.name;opponentSelect.appendChild(o);});
      if(opErr) console.warn('Could not load opponent teams',opErr);
    }
    await updateTeamChallengePreview();
}

async function updateTeamChallengePreview(){
    const teamId=document.getElementById('challengeMyTeam')?.value;
    const opponentTeamId=document.getElementById('challengeOpponentTeam')?.value;
    const preview=document.getElementById('teamChallengePreview');
    const picker=document.getElementById('shufflePlayerPicker');
    const list=document.getElementById('shufflePlayerList');
    if(!preview)return;
    if(!teamId){preview.style.display='none';preview.innerHTML='';if(picker)picker.style.display='none';if(list)list.innerHTML='';return;}
    const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const {data:myRoster,error:myErr}=await client.from('team_members').select('user_id,profiles(id,full_name,inter_rivalry_id)').eq('team_id',teamId);
    if(myErr){preview.style.display='block';preview.textContent='Could not load your team roster.';if(picker)picker.style.display='none';return;}
    const uniqueMap=new Map();
    (myRoster||[]).forEach(r=>{if(r.profiles?.id)uniqueMap.set(r.profiles.id,r.profiles);});
    const myMembers=[...uniqueMap.values()];
    if(selectedChallengeMode==='team_vs_team'){
      if(picker)picker.style.display='none';
      if(!opponentTeamId){preview.style.display='block';preview.innerHTML=`Your team: <strong>${myMembers.length} players</strong><br>Select the opponent's team to preview both rosters.`;return;}
      const {data:oppRoster,error:oppErr}=await client.from('team_members').select('user_id,profiles(id,full_name,inter_rivalry_id)').eq('team_id',opponentTeamId);
      if(oppErr){preview.style.display='block';preview.textContent='Could not load opponent team roster.';return;}
      const oppMembers=(oppRoster||[]).map(r=>r.profiles).filter(Boolean);
      const myHasUser=myMembers.some(m=>m.id===user.id), oppHasOpponent=oppMembers.some(m=>m.id===selectedProfileId);
      preview.style.display='block';
      if(!myHasUser||!oppHasOpponent){preview.innerHTML='⚠️ Your selected team must include you, and the opponent team must include the challenged player.';return;}
      preview.innerHTML=`🛡️ <strong>Your team:</strong> ${myMembers.length} players<br>⚔️ <strong>Opponent team:</strong> ${oppMembers.length} players<br><span style="font-size:12px;color:#888;">Both existing rosters will compete as teams. No random splitting.</span>`;
      return;
    }
    const containsMe=myMembers.some(m=>m.id===user.id), containsOpponent=myMembers.some(m=>m.id===selectedProfileId);
    preview.style.display='block';
    if(!containsMe||!containsOpponent){if(picker)picker.style.display='none';preview.innerHTML='⚠️ Both you and the challenged player must belong to this roster.';return;}
    if(picker&&list){
      picker.style.display='block';
      // Preserve the user's current choices when refreshing the preview; a new team starts with everyone selected.
      const previous=new Set([...list.querySelectorAll('input[data-shuffle-player]:checked')].map(el=>el.value));
      const hadChoices=list.querySelectorAll('input[data-shuffle-player]').length>0;
      list.innerHTML=myMembers.map(m=>{
        const isCaptain=m.id===user.id||m.id===selectedProfileId;
        const checked=isCaptain||!hadChoices||previous.has(m.id);
        const label=escapeHTML(m.full_name||m.inter_rivalry_id||'Player');
        const id=escapeHTML(m.id);
        return `<label style="display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid #333;border-radius:8px;background:#181818;cursor:${isCaptain?'default':'pointer'};"><input data-shuffle-player type="checkbox" value="${id}" ${checked?'checked':''} ${isCaptain?'disabled':''} onchange="updateShuffleSelectedCount()" style="accent-color:#e7bd58;width:17px;height:17px;flex-shrink:0;"><span style="flex:1;">${label}${isCaptain?` <small style="color:#f3d27a;">${m.id===user.id?'(You / Captain)':'(Opponent Captain)'}</small>`:''}</span></label>`;
      }).join('');
      // Disabled captain checkboxes are still part of the selected roster; collect them explicitly in the count helper.
      updateShuffleSelectedCount();
    }
    const selectedCount=list?[...list.querySelectorAll('input[data-shuffle-player]:checked')].length:myMembers.length;
    preview.innerHTML=`🔀 <strong style="color:#fff;">${selectedCount} players selected</strong> from ${myMembers.length} roster members.<br>👑 You and the challenged player will be captains on opposite sides.<br><span style="font-size:12px;color:#888;">Only selected players will be shuffled into balanced teams. Untick anyone who won't be available.</span>`;
}

function getSelectedShufflePlayerIds(){
  const list=document.getElementById('shufflePlayerList');
  if(!list)return [];
  return [...list.querySelectorAll('input[data-shuffle-player]')].filter(el=>el.checked||el.disabled).map(el=>el.value);
}

function updateShuffleSelectedCount(){
  const count=document.getElementById('shuffleSelectedCount');
  const ids=getSelectedShufflePlayerIds();
  if(count)count.textContent=`${ids.length} selected`;
  const preview=document.getElementById('teamChallengePreview');
  if(preview&&selectedChallengeMode==='team'&&preview.style.display!=='none'){
    const total=document.querySelectorAll('#shufflePlayerList input[data-shuffle-player]').length;
    const first=preview.innerHTML.replace(/<strong style="color:#fff;">\d+ players selected<\/strong> from \d+ roster members\./,`<strong style="color:#fff;">${ids.length} players selected</strong> from ${total} roster members.`);
    preview.innerHTML=first;
  }
}

function isSportsChallengeSkill(skillMeta){
    return normalizeSkillName(skillMeta?.category) === "sports";
}

function shuffleArray(input){
    const arr = [...input];
    for(let i = arr.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

async function generateRandomSportsTeams(teamId, challengerId, opponentId, selectedMemberIds = null){
    const { data: roster, error } = await client
        .from("team_members")
        .select("user_id,profiles(id,full_name,inter_rivalry_id)")
        .eq("team_id", teamId);

    if(error) throw error;

    const members = (roster || []).map(r => r.profiles).filter(Boolean);
    const unique = [];
    const seen = new Set();

    for(const member of members){
        if(!seen.has(member.id)){
            seen.add(member.id);
            unique.push(member);
        }
    }

    if(!unique.some(m => m.id === challengerId) || !unique.some(m => m.id === opponentId)){
        throw new Error("Both captains must belong to the selected team.");
    }

    // If a subset was chosen, shuffle only those available players. Captains are always retained.
    const selectedSet = selectedMemberIds ? new Set(selectedMemberIds) : new Set(unique.map(m => m.id));
    selectedSet.add(challengerId);
    selectedSet.add(opponentId);
    const participating = unique.filter(m => selectedSet.has(m.id));
    if(participating.length < 2){
        throw new Error("Select at least the two captains to create a shuffle challenge.");
    }

    const remaining = participating.filter(m => m.id !== challengerId && m.id !== opponentId);
    const shuffled = shuffleArray(remaining);

    // Captains are always on opposite sides. Everyone else is distributed
    // to keep the two sides as even as mathematically possible.
    const challengerSide = [{...unique.find(m => m.id === challengerId), captain: true}];
    const opponentSide = [{...unique.find(m => m.id === opponentId), captain: true}];

    shuffled.forEach(member => {
        if(challengerSide.length <= opponentSide.length){
            challengerSide.push({...member, captain: false});
        }else{
            opponentSide.push({...member, captain: false});
        }
    });

    return {
        teamId,
        totalPlayers: participating.length,
        selectedMemberIds: participating.map(m => m.id),
        challengerSide,
        opponentSide
    };
}

function teamMemberNames(members){
    return (members || []).map(m => escapeHTML(m.full_name || m.inter_rivalry_id || "Player")).join(", ");
}

function getTeamChallengeDisplay(rules){
    if(!rules?.team_challenge) return "";
    const a = rules.team_a_members || [];
    const b = rules.team_b_members || [];
    const aWon = rules.result === "team_challenger_win";
    const bWon = rules.result === "team_opponent_win";

    return `
        <div style="margin-top:12px;padding:12px;background:#111;border:1px solid #333;border-radius:12px;">
            <strong style="color:#fff;">${rules.team_challenge_type === 'team_vs_team' ? '🛡️ Team vs Team' : '🔀 Shuffle Match'} — ${escapeHTML(rules.team_name || "Random Team Match")}${rules.opponent_team_name ? ' vs '+escapeHTML(rules.opponent_team_name) : ''}</strong>
            <div style="margin-top:8px;color:#aaa;">
                <strong style="color:#fff;">Team A ${aWon ? "🏆" : ""}</strong> (${a.length})<br>
                ${teamMemberNames(a)}
            </div>
            <div style="margin-top:8px;color:#aaa;">
                <strong style="color:#fff;">Team B ${bWon ? "🏆" : ""}</strong> (${b.length})<br>
                ${teamMemberNames(b)}
            </div>
        </div>`;
}

function getTeamParticipantResult(rules, userId){
    if(!rules?.team_challenge) return null;
    const a = (rules.team_a_members || []).some(m => (m.id || m.user_id) === userId);
    const b = (rules.team_b_members || []).some(m => (m.id || m.user_id) === userId);
    if(rules.result === "draw") return "DRAW";
    if(rules.result === "team_challenger_win") return a ? "WIN 🎉" : b ? "LOSS 😔" : null;
    if(rules.result === "team_opponent_win") return b ? "WIN 🎉" : a ? "LOSS 😔" : null;
    return null;
}

// ==================== INTEGRATED AI QUIZ CHALLENGES ====================
const AI_QUIZ_SKILLS = new Set([
    "bca",
    "bba",
    "b.com",
    "bcom",
    "coding",
    "web development",
    "web development quiz"
]);

function normalizeSkillName(value){
    return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isAIQuizSkill(categoryName, skillName){
    const skill = normalizeSkillName(skillName);
    const category = normalizeSkillName(categoryName);
    return AI_QUIZ_SKILLS.has(skill) ||
        (category === "education" && ["bca","bba","b.com","bcom"].includes(skill)) ||
        (category === "technology" && ["coding","web development","web development quiz"].includes(skill));
}

function getSelectedChallengeSkillMeta(){
    const select = document.getElementById("challengeSkill");
    const option = select?.selectedOptions?.[0];
    if(!option || !select?.value) return null;
    return {
        id: select.value,
        name: option.dataset.skillName || option.textContent || "Skill",
        category: option.dataset.categoryName || ""
    };
}

function localDateTimeInputValue(date){
    const pad = n => String(n).padStart(2,"0");
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function setDefaultChallengeTimes(){
    const start = document.getElementById("challengeStart");
    const end = document.getElementById("challengeEnd");
    if(!start || !end) return;
    const now = new Date();
    const finish = new Date(now.getTime() + 60 * 60 * 1000);
    if(!start.value) start.value = localDateTimeInputValue(now);
    if(!end.value) end.value = localDateTimeInputValue(finish);
}

async function handleChallengeSkillChange(){
    const meta = getSelectedChallengeSkillMeta();
    const game = document.getElementById("challengeGame");
    const gameGroup = document.getElementById("challengeGameGroup");
    const info = document.getElementById("aiQuizChallengeInfo");
    const aiFields = document.getElementById("aiQuizFields");
    const aiSubject = document.getElementById("aiQuizSubject");
    const aiTopics = document.getElementById("aiQuizTopics");
    const title = document.getElementById("challengeTitle");
    const description = document.getElementById("challengeDescription");
    const message = document.getElementById("challengeMessage");

    if(!meta){
        if(gameGroup) gameGroup.style.display = "block";
        if(info) info.style.display = "none";
        if(aiFields) aiFields.style.display = "none";
        if(game) game.value = "";
        if(title) title.readOnly = false;
        if(description) description.readOnly = false;
        updateChallengeGameInfo();
        return;
    }

    const ai = isAIQuizSkill(meta.category, meta.name);

    if(selectedChallengeMode === "team" && !isSportsChallengeSkill(meta)){
        setChallengeMode("solo");
        if(message) message.textContent = "👥 Team mode is only available for Sports challenges.";
    }

    if(ai){
        if(selectedChallengeMode === "team"){
            setChallengeMode("solo");
            if(message) message.textContent = "AI Quiz Challenges currently use SOLO mode.";
        }

        if(gameGroup) gameGroup.style.display = "none";
        if(info) info.style.display = "block";
        if(aiFields) aiFields.style.display = "block";
        if(game) game.value = "ai_quiz";
        if(title){
            const subjectValue = (aiSubject?.value || "").trim();
            title.value = subjectValue
                ? `🤖 ${meta.name} • ${subjectValue} Quiz Challenge`
                : `🤖 ${meta.name} Quiz Challenge`;
            title.readOnly = true;
        }
        if(description){
            description.value = `AI-generated quiz challenge for ${meta.category ? meta.category + " • " : ""}${meta.name}.`;
            description.readOnly = true;
        }
        setDefaultChallengeTimes();
        if(message && !message.textContent.includes("SOLO")) message.textContent = "🤖 AI Quiz will be generated automatically when you send this challenge.";
    }else{
        if(gameGroup) gameGroup.style.display = "block";
        if(info) info.style.display = "none";
        if(aiFields) aiFields.style.display = "none";
        if(game && game.value === "ai_quiz") game.value = "";
        if(title) title.readOnly = false;
        if(description) description.readOnly = false;
        if(message && message.textContent.includes("AI Quiz")) message.textContent = "";
        updateChallengeGameInfo();
    }
}

function updateAIQuizChallengeTitle(){
    const meta = getSelectedChallengeSkillMeta();
    const title = document.getElementById("challengeTitle");
    const subject = document.getElementById("aiQuizSubject")?.value.trim();
    if(!title || !meta || !isAIQuizSkill(meta.category, meta.name)) return;
    title.value = subject
        ? `🤖 ${meta.name} • ${subject} Quiz Challenge`
        : `🤖 ${meta.name} Quiz Challenge`;
}

document.addEventListener("input", (event) => {
    if(event.target?.id === "aiQuizSubject") updateAIQuizChallengeTitle();
});

async function getIntegratedQuizContext(skillName){
    const { data: { user } } = await client.auth.getUser();
    if(!user) throw new Error("Please login first.");

    const { data: membership, error } = await client
        .from("college_memberships")
        .select("course,year_of_study,specialization")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();

    if(error) throw error;

    const normalized = normalizeSkillName(skillName);
    let course = membership?.course || "BCA";
    if(["bca","bba","b.com","bcom"].includes(normalized)){
        course = normalized === "bcom" ? "B.COM" : normalized.toUpperCase();
    }

    const year = Number(membership?.year_of_study || 1);
    const semester = Math.min(6, Math.max(1, ((year - 1) * 2) + 1));

    return { course, semester, specialization: membership?.specialization || null };
}

async function createIntegratedAIQuizChallenge({ user, subcategoryId, skillMeta, startDate, endDate, title, description, subject, topics, difficulty, questionCount, timePerQuestion }){
    const context = await getIntegratedQuizContext(skillMeta.name);
    const safeDifficulty = ["easy","medium","hard"].includes(String(difficulty || "").toLowerCase()) ? String(difficulty).toLowerCase() : "medium";
    const safeQuestionCount = [5,10,15,20].includes(Number(questionCount)) ? Number(questionCount) : 10;
    const safeTimePerQuestion = [15,30,45,60,90,120].includes(Number(timePerQuestion)) ? Number(timePerQuestion) : 30;
    const finalDifficulty = safeDifficulty;
    const finalQuestionCount = safeQuestionCount;
    const finalTimePerQuestion = safeTimePerQuestion;

    // Create the quiz record first. The normal challenge is linked to it
    // through rules.ai_quiz_challenge_id and the quiz is linked back through
    // ranking_challenge_id after the normal challenge exists.
    const { data: quiz, error: quizInsertError } = await client
        .from("quiz_challenges")
        .insert({
            challenger_id: user.id,
            opponent_id: selectedProfileId,
            course: context.course,
            semester: context.semester,
            subject,
            topics,
            difficulty: finalDifficulty,
            question_count: finalQuestionCount,
            time_per_question: finalTimePerQuestion,
            mode: "1v1",
            status: "pending",
            generated_by: "ai",
            subcategory_id: subcategoryId,
            starts_at: startDate.toISOString(),
            ends_at: endDate.toISOString()
        })
        .select("id")
        .single();

    if(quizInsertError) throw quizInsertError;

    try{
        const { data: challenge, error: challengeError } = await client
            .from("challenges")
            .insert({
                challenger_id: user.id,
                opponent_id: selectedProfileId,
                subcategory_id: subcategoryId,
                title,
                description: description || null,
                starts_at: startDate.toISOString(),
                ends_at: endDate.toISOString(),
                status: "pending",
                mode: "solo",
                rules: {
                    game: "ai_quiz",
                    ai_quiz: true,
                    ai_quiz_challenge_id: quiz.id,
                    result_source: "ai_quiz",
                    result_status: "awaiting_quiz",
                    points: { win: 3, draw: 1 }
                }
            })
            .select("id")
            .single();

        if(challengeError) throw challengeError;

        const { error: linkError } = await client
            .from("quiz_challenges")
            .update({ ranking_challenge_id: challenge.id, updated_at: new Date().toISOString() })
            .eq("id", quiz.id);

        if(linkError) throw linkError;

        // Ask the existing Gemini Edge Function to generate the questions.
        const { data: generated, error: generateError } =
            await client.functions.invoke("generate-quiz", {
                body: { challenge_id: quiz.id }
            });

        if(generateError) throw generateError;
        if(!generated?.success){
            throw new Error(generated?.error || "Quiz generation failed.");
        }

        return {
            challengeId: challenge.id,
            quizId: quiz.id,
            questionCount: generated.question_count || finalQuestionCount,
            difficulty: generated.difficulty || finalDifficulty,
            timePerQuestion: generated.time_per_question || finalTimePerQuestion,
            course: context.course,
            semester: context.semester
        };
    }catch(error){
        // Keep the quiz row so the existing retry mechanism can recover it.
        await client.from("quiz_challenges").update({
            generation_error: error?.message || "Quiz generation failed",
            updated_at: new Date().toISOString()
        }).eq("id", quiz.id);
        throw error;
    }
}

// ==================== RESULT METHOD ====================
function updateChallengeGameInfo(){
    const game = document.getElementById("challengeGame")?.value;
    const box = document.getElementById("challengeGameInfo");
    if(!box) return;
    if(game === "chess") box.textContent = "♟️ After the Chess.com game finishes, INTER RIVALRY can check the public game record and report the result.";
    else if(game === "freefire") box.textContent = "🔥 After the match, the final result screenshot will be submitted for verification.";
    else if(game === "manual_report") box.textContent = "📝 After the match, either player can report the result. The other player must confirm or dispute it before ranking points are awarded.";
    else box.textContent = "";
}

async function saveChessUsername(){
    const input = document.getElementById("chessUsername");
    const message = document.getElementById("chessUsernameMessage");
    const { data: { user } } = await client.auth.getUser();
    if(!user) return;
    const username = (input?.value || "").trim();
    if(!username) { if(message) message.textContent = "Enter your Chess.com username."; return; }
    if(!/^[A-Za-z0-9_]{3,25}$/.test(username)) { if(message) message.textContent = "Enter a valid Chess.com username."; return; }
    if(message) message.textContent = "Saving...";
    const { error } = await client.from("profiles").update({ chess_com_username: username }).eq("id", user.id);
    if(error){ if(message) message.textContent = "Error: " + error.message; return; }
    if(currentUserProfile) currentUserProfile.chess_com_username = username;
    if(message) message.textContent = "✅ Chess.com username saved.";
}

async function loadChessUsername(){
    const input = document.getElementById("chessUsername");
    if(!input) return;
    const { data: { user } } = await client.auth.getUser();
    if(!user) return;
    const { data } = await client.from("profiles").select("chess_com_username").eq("id", user.id).maybeSingle();
    input.value = data?.chess_com_username || "";
}

// ==================== SEND CHALLENGE ====================
async function sendChallenge(){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return alert("Please login first.");
    if(!selectedProfileId) return alert("No opponent selected.");
    if(user.id === selectedProfileId) return alert("You cannot challenge yourself.");
    const challengeBattlefield = normalizeBattlefield(currentChallengeBattlefield || currentBattlefield || 'local');
    // Local challenges do not belong to a community. Keep a safe default scope so
    // the insert below never references an undefined variable in Local mode.
    let scope = { ids: [], communityId: null, collegeId: null };
    if(challengeBattlefield !== 'local') {
        try {
            scope = await getBattlefieldMemberIds(challengeBattlefield, user.id);
        } catch (scopeError) {
            console.error('Could not verify challenge battlefield:', scopeError);
            const msg = document.getElementById('challengeMessage');
            if(msg) msg.textContent = 'Could not verify this battlefield. Please try again.';
            return;
        }
        if(!scope.ids.includes(selectedProfileId)) return alert(`⚠️ Challenge blocked: opponent is outside your ${challengeBattlefield} battlefield.`);
    }

    const skillMeta = getSelectedChallengeSkillMeta();
    const subcategoryId = skillMeta?.id || null;
    const game = document.getElementById("challengeGame")?.value;
    const title = document.getElementById("challengeTitle")?.value.trim();
    const description = document.getElementById("challengeDescription")?.value.trim();
    const aiSubject = document.getElementById("aiQuizSubject")?.value.trim();
    const aiTopics = document.getElementById("aiQuizTopics")?.value.trim();
    const aiDifficulty = document.getElementById("aiQuizDifficulty")?.value || "medium";
    const aiQuestionCount = Number(document.getElementById("aiQuizQuestionCount")?.value || 10);
    const aiTimePerQuestion = Number(document.getElementById("aiQuizTimePerQuestion")?.value || 30);
    const startValue = document.getElementById("challengeStart")?.value;
    const endValue = document.getElementById("challengeEnd")?.value;
    const message = document.getElementById("challengeMessage");

    if(!skillMeta) return message.textContent = "Select a skill.";

    const aiQuiz = isAIQuizSkill(skillMeta.category, skillMeta.name);

    // AI Quiz challenges are SOLO only and are generated automatically.
    if(aiQuiz){
        if(selectedChallengeMode !== "solo"){
            setChallengeMode("solo");
        }

        if(!aiSubject){
            return message.textContent = "Enter the quiz subject.";
        }
        if(aiSubject.length < 2){
            return message.textContent = "Subject name is too short.";
        }
        if(!aiTopics){
            return message.textContent = "Enter the topic / syllabus for the AI quiz.";
        }
        if(aiTopics.length < 2){
            return message.textContent = "Topic / syllabus is too short.";
        }

        updateAIQuizChallengeTitle();
        const aiTitle = document.getElementById("challengeTitle")?.value.trim();

        if(!startValue || !endValue) setDefaultChallengeTimes();

        const freshStart = document.getElementById("challengeStart")?.value;
        const freshEnd = document.getElementById("challengeEnd")?.value;
        const startDate = new Date(freshStart);
        const endDate = new Date(freshEnd);

        if(isNaN(startDate.getTime()) || isNaN(endDate.getTime())){
            return message.textContent = "Could not set the quiz start/end time.";
        }
        if(endDate <= startDate){
            return message.textContent = "End time must be after start.";
        }

        message.textContent = "🤖 Creating challenge and generating AI quiz...";
        const btn = document.querySelector('#challengePage button[onclick="sendChallenge()"]');
        if(btn){ btn.disabled = true; btn.textContent = "⏳ GENERATING QUIZ..."; }

        try{
            const result = await createIntegratedAIQuizChallenge({
                user,
                subcategoryId,
                skillMeta,
                startDate,
                endDate,
                subject: aiSubject,
                topics: aiTopics,
                difficulty: aiDifficulty,
                questionCount: aiQuestionCount,
                timePerQuestion: aiTimePerQuestion,
                title: aiTitle || `🤖 ${skillMeta.name} • ${aiSubject} Quiz Challenge`,
                description: description || `AI-generated quiz for ${aiSubject}. Focus: ${aiTopics}.`
            });

            message.textContent = `✅ Challenge sent! ${result.questionCount} AI questions generated.`;
            alert(
                `🤖 AI Quiz Challenge created!\n\n` +
                `${result.course} • Semester ${result.semester}\n` +
                `${skillMeta.name}\n` +
                `${result.questionCount} questions\n` +
                `Difficulty: ${result.difficulty}\n` +
                `Time: ${result.timePerQuestion} seconds/question\n\n` +
                `Your rival can accept the challenge from My Challenges.`
            );

            document.getElementById("challengeSkill").value = "";
            document.getElementById("aiQuizSubject").value = "";
            document.getElementById("aiQuizTopics").value = "";
            document.getElementById("aiQuizDifficulty").value = "medium";
            document.getElementById("aiQuizQuestionCount").value = "10";
            document.getElementById("aiQuizTimePerQuestion").value = "30";
            document.getElementById("challengeTitle").value = "";
            document.getElementById("challengeDescription").value = "";
            document.getElementById("challengeStart").value = "";
            document.getElementById("challengeEnd").value = "";
            document.getElementById("challengeGame").value = "";
            handleChallengeSkillChange();
            await loadMyChallenges();
        }catch(error){
            console.error("Integrated AI Quiz Challenge failed:", error);
            message.textContent = "❌ " + (error?.message || "Could not create AI Quiz Challenge.");
        }finally{
            if(btn){ btn.disabled = false; btn.textContent = "⚔️ SEND CHALLENGE"; }
        }
        return;
    }

    // ---------- NORMAL CHALLENGE FLOW ----------
    if(!game) return message.textContent = "Select a game / result method.";
    if(game === "chess" && !(currentUserProfile?.chess_com_username || "").trim()) return message.textContent = "Save your Chess.com username in your profile first.";
    if(!title) return message.textContent = "Enter a title.";
    if(!startValue || !endValue) return message.textContent = "Select start and end times.";

    const startDate = new Date(startValue), endDate = new Date(endValue);
    if(endDate <= startDate) return message.textContent = "End time must be after start.";

    let myTeamId = null;
    let generatedSportsTeams = null;
    let selectedTeamName = null;

    if(selectedChallengeMode === "team" || selectedChallengeMode === "team_vs_team"){
        if(!isSportsChallengeSkill(skillMeta)){
            setChallengeMode("solo");
            return message.textContent = "Team modes are only available for Sports challenges.";
        }
        myTeamId=document.getElementById('challengeMyTeam')?.value||null;
        if(!myTeamId) return message.textContent='Select your team.';
        const {data:selectedTeam,error:selectedTeamError}=await client.from('teams').select('id,name').eq('id',myTeamId).maybeSingle();
        if(selectedTeamError||!selectedTeam) return message.textContent='Could not load your selected team.';
        selectedTeamName=selectedTeam.name;
        try{
          if(selectedChallengeMode==='team'){
            const selectedIds=getSelectedShufflePlayerIds();
            if(selectedIds.length<2) return message.textContent='Select at least you and the challenged player.';
            generatedSportsTeams=await generateRandomSportsTeams(myTeamId,user.id,selectedProfileId,selectedIds);
          }else{
            const opponentTeamId=document.getElementById('challengeOpponentTeam')?.value||null;
            if(!opponentTeamId) return message.textContent="Select the opponent's team.";
            const {data:oppTeam,error:oppTeamErr}=await client.from('teams').select('id,name').eq('id',opponentTeamId).maybeSingle();
            if(oppTeamErr||!oppTeam) return message.textContent="Could not load opponent's team.";
            const [{data:myRoster,error:myRosterErr},{data:oppRoster,error:oppRosterErr}]=await Promise.all([
              client.from('team_members').select('user_id,profiles(id,full_name,inter_rivalry_id)').eq('team_id',myTeamId),
              client.from('team_members').select('user_id,profiles(id,full_name,inter_rivalry_id)').eq('team_id',opponentTeamId)
            ]);
            if(myRosterErr||oppRosterErr) return message.textContent='Could not load both team rosters.';
            const teamA=(myRoster||[]).map(r=>r.profiles).filter(Boolean);
            const teamB=(oppRoster||[]).map(r=>r.profiles).filter(Boolean);
            if(!teamA.some(m=>m.id===user.id)) return message.textContent='You must be a member of your selected team.';
            if(!teamB.some(m=>m.id===selectedProfileId)) return message.textContent='The challenged player must belong to the selected opponent team.';
            if(!teamA.length||!teamB.length) return message.textContent='Both teams need at least one member.';
            generatedSportsTeams={teamId:myTeamId,totalPlayers:teamA.length+teamB.length,challengerSide:teamA,opponentSide:teamB,teamVsTeam:true,opponentTeamId,opponentTeamName:oppTeam.name};
          }
        }catch(err){return message.textContent='Could not prepare the teams: '+(err?.message||err);}
    }

    const { data: existing } = await client.from("challenges").select("id").eq("challenger_id",user.id).eq("opponent_id",selectedProfileId).eq("status","pending").limit(1);
    if(existing?.length) return message.textContent = "You already have a pending challenge.";

    message.textContent = "Sending challenge...";

    const sendButton = document.querySelector('#challengePage button[onclick="sendChallenge()"]');
    if(sendButton){ sendButton.disabled = true; sendButton.textContent = '⏳ SENDING...'; }
    let sendTimedOut = false;
    const insertPromise = client.from("challenges").insert({
        challenger_id: user.id,
        opponent_id: selectedProfileId,
        subcategory_id: subcategoryId,
        title,
        description: description || null,
        starts_at: startDate.toISOString(),
        ends_at: endDate.toISOString(),
        status: "pending",
        mode: selectedChallengeMode,
        battlefield_type: challengeBattlefield,
        community_id: scope.communityId || null,
        rules: {
            game,
            college_id: challengeBattlefield === 'college' ? (scope.collegeId || null) : null,
            result_source: game === "chess" ? "chesscom_pubapi" : (game === "freefire" ? "freefire_screenshot" : "manual_report"),
            result_status: "awaiting_match",
            team_challenge: selectedChallengeMode === "team" || selectedChallengeMode === "team_vs_team",
            team_challenge_type: selectedChallengeMode === "team_vs_team" ? "team_vs_team" : (selectedChallengeMode === "team" ? "shuffle" : "solo"),
            team_id: generatedSportsTeams?.teamId || null,
            team_name: selectedChallengeMode === "team_vs_team" ? selectedTeamName : (selectedTeamName || "Random Teams"),
            opponent_team_id: generatedSportsTeams?.opponentTeamId || null,
            opponent_team_name: generatedSportsTeams?.opponentTeamName || null,
            team_total_players: generatedSportsTeams?.totalPlayers || null,
            team_selected_member_ids: generatedSportsTeams?.selectedMemberIds || null,
            team_a_captain_id: user.id,
            team_b_captain_id: selectedProfileId,
            team_a_members: generatedSportsTeams?.challengerSide || [],
            team_b_members: generatedSportsTeams?.opponentSide || []
        }
    }).select("id").single();
    let insertResult;
    try {
        insertResult = await Promise.race([
            insertPromise,
            new Promise((_, reject) => setTimeout(() => { sendTimedOut = true; reject(new Error('Request timed out. Check your internet connection and try again.')); }, 15000))
        ]);
    } catch(insertFailure) {
        message.textContent = '❌ ' + (insertFailure?.message || 'Could not send challenge. Please try again.');
        return;
    } finally {
        if(sendButton){ sendButton.disabled = false; sendButton.textContent = '⚔️ SEND CHALLENGE'; }
    }
    const { data: challenge, error } = insertResult;
    if(error){ message.textContent = "Error: " + error.message; return; }

    message.textContent = selectedChallengeMode === "team"
        ? `🔀 Shuffle challenge sent! ${generatedSportsTeams.challengerSide.length}v${generatedSportsTeams.opponentSide.length} — players randomly balanced.`
        : selectedChallengeMode === "team_vs_team"
          ? `🛡️ Team vs Team challenge sent! ${generatedSportsTeams.challengerSide.length} vs ${generatedSportsTeams.opponentSide.length} players.`
          : "Challenge sent! ⚔️";
    document.getElementById("challengeTitle").value = "";
    document.getElementById("challengeDescription").value = "";
    document.getElementById("challengeGame").value = "";
    document.getElementById("challengeSkill").value = "";
    document.getElementById("challengeStart").value = "";
    document.getElementById("challengeEnd").value = "";
    document.getElementById("challengeMyTeam").value = "";
    const teamPreviewReset = document.getElementById("teamChallengePreview");
    if(teamPreviewReset){ teamPreviewReset.style.display = "none"; teamPreviewReset.innerHTML = ""; }
    handleChallengeSkillChange();
    setChallengeMode("solo");
}


// ==================== AI QUIZ BATTLE ====================
async function loadQuizOpponent(){
    const nameEl = document.getElementById("quizOpponentName");
    const idEl = document.getElementById("quizOpponentId");
    if(!selectedProfileId){
        nameEl.textContent = "Not selected";
        idEl.textContent = "-";
        return;
    }
    const { data: opponent, error } = await client
        .from("profiles")
        .select("full_name,inter_rivalry_id")
        .eq("id", selectedProfileId)
        .maybeSingle();

    if(error || !opponent){
        nameEl.textContent = "Opponent not found";
        idEl.textContent = "-";
        return;
    }

    nameEl.textContent = opponent.full_name || "User";
    idEl.textContent = opponent.inter_rivalry_id || "-";
}

function quizDefaultTimes(){
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    return {
        starts_at: now.toISOString(),
        ends_at: end.toISOString()
    };
}

async function createAndGenerateQuizBattle(){
    const message = document.getElementById("quizCreateMessage");
    const btn = document.getElementById("generateQuizBtn");

    const { data: { user } } = await client.auth.getUser();
    if(!user) return alert("Please login first.");
    if(!selectedProfileId) return alert("Select an opponent first.");
    if(user.id === selectedProfileId) return alert("You cannot challenge yourself.");

    const course = document.getElementById("quizCourse")?.value;
    const semester = Number(document.getElementById("quizSemester")?.value);
    const subject = document.getElementById("quizSubject")?.value.trim();
    const topics = document.getElementById("quizTopics")?.value.trim() || null;
    const difficulty = document.getElementById("quizDifficulty")?.value;
    const questionCount = Number(document.getElementById("quizQuestionCount")?.value);
    const timePerQuestion = Number(document.getElementById("quizTimePerQuestion")?.value);
    const titleInput = document.getElementById("quizTitle")?.value.trim();

    if(!course || ![1,2,3,4,5,6].includes(semester)){
        message.textContent = "Select a valid course and semester.";
        return;
    }
    if(!subject){
        message.textContent = "Enter the subject.";
        return;
    }
    if(subject.length < 2){
        message.textContent = "Subject name is too short.";
        return;
    }

    const title = titleInput ||
        `${course} • Sem ${semester} • ${subject} Quiz Battle`;

    const times = quizDefaultTimes();

    btn.disabled = true;
    btn.textContent = "⏳ CREATING QUIZ...";
    message.textContent = "Creating Quiz Battle...";

    try{
        const { data: challenge, error: insertError } = await client
            .from("quiz_challenges")
            .insert({
                challenger_id: user.id,
                opponent_id: selectedProfileId,
                course,
                semester,
                subject,
                topics,
                difficulty,
                question_count: questionCount,
                time_per_question: timePerQuestion,
                mode: "1v1",
                status: "pending",
                generated_by: "ai",
                starts_at: times.starts_at,
                ends_at: times.ends_at
            })
            .select("id")
            .single();

        if(insertError) throw insertError;

        message.textContent = "🤖 Gemini is generating your quiz...";

        const { data: generated, error: generateError } =
            await client.functions.invoke("generate-quiz", {
                body: { challenge_id: challenge.id }
            });

        if(generateError) throw generateError;

        if(!generated?.success){
            throw new Error(generated?.error || "Quiz generation failed.");
        }

        message.textContent =
            `✅ Quiz generated successfully! ${generated.question_count || questionCount} questions are ready.`;

        alert(
            `🤖 Quiz Battle created!\n\n` +
            `${course} • Semester ${semester}\n` +
            `${subject}\n` +
            `${generated.question_count || questionCount} questions\n\n` +
            `The quiz is saved and ready for the battle.`
        );

        document.getElementById("quizSubject").value = "";
        document.getElementById("quizTopics").value = "";
        document.getElementById("quizTitle").value = "";

        await loadQuizBattles();

    }catch(error){
        console.error("Quiz creation/generation failed:", error);
        message.textContent = "❌ " + (error?.message || "Could not generate quiz.");
    }finally{
        btn.disabled = false;
        btn.textContent = "🤖 CREATE & GENERATE QUIZ";
    }
}

async function retryQuizGeneration(challengeId){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return alert("Please login first.");

    const { data: challenge, error: challengeError } = await client
        .from("quiz_challenges")
        .select("id,challenger_id,status")
        .eq("id", challengeId)
        .maybeSingle();

    if(challengeError || !challenge){
        return alert("Could not load the quiz battle.");
    }

    if(challenge.challenger_id !== user.id){
        return alert("Only the quiz challenger can retry generation.");
    }

    if(["ready","active","completed"].includes(challenge.status)){
        return alert("This quiz is already generated and ready.");
    }

    const { error: resetError } = await client
        .from("quiz_challenges")
        .update({
            status: "pending",
            generation_error: null,
            updated_at: new Date().toISOString()
        })
        .eq("id", challengeId);

    if(resetError){
        return alert("Could not reset generation: " + resetError.message);
    }

    const { data: generated, error: generateError } =
        await client.functions.invoke("generate-quiz", {
            body: { challenge_id: challengeId }
        });

    if(generateError){
        alert("Gemini generation failed: " + generateError.message);
    } else if(!generated?.success){
        alert("Gemini generation failed: " + (generated?.error || "Unknown error"));
    } else {
        alert(`✅ Quiz generated successfully! ${generated.question_count || ""} questions are ready.`);
    }

    await loadQuizBattles();
}

async function getQuizBattleStatus(challengeId){
    const { data, error } = await client.rpc("get_quiz_battle_status", {
        p_quiz_challenge_id: challengeId
    });
    if(error){
        console.warn("Quiz battle status check failed:", error.message);
        return null;
    }
    return Array.isArray(data) ? (data[0] || null) : data;
}

async function deleteQuizBattle(challengeId){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return alert("Please login first.");

    const { data: challenge, error: loadError } = await client
        .from("quiz_challenges")
        .select("id,challenger_id")
        .eq("id", challengeId)
        .maybeSingle();

    if(loadError || !challenge){
        return alert("Could not find this quiz battle.");
    }

    if(challenge.challenger_id !== user.id){
        return alert("Only the quiz creator can delete this quiz.");
    }

    const { error } = await client.rpc("delete_quiz_battle", {
        p_quiz_challenge_id: challengeId
    });

    if(error){
        return alert("Could not delete quiz: " + error.message);
    }

    await loadQuizBattles();
}

let quizGenerationPollTimer = null;

async function loadQuizBattles(){
    const list = document.getElementById("quizBattlesList");
    if(!list) return;

    list.innerHTML = "<div class='empty-box'>Loading quiz battles...</div>";

    const { data: { user } } = await client.auth.getUser();
    if(!user){
        list.innerHTML = "<div class='empty-box'>Please login first.</div>";
        return;
    }

    const { data, error } = await client
        .from("quiz_challenges")
        .select("id,challenger_id,opponent_id,course,semester,subject,topics,difficulty,question_count,time_per_question,mode,status,generation_error,winner_id,result,ranking_challenge_id,subcategory_id,starts_at,ends_at,created_at,updated_at")
        .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
        .order("created_at",{ascending:false});

    if(error){
        list.innerHTML = `<div class='empty-box'>Error: ${escapeHTML(error.message)}</div>`;
        return;
    }

    if(!data?.length){
        list.innerHTML = "<div class='empty-box'>No AI Quiz Battles yet.</div>";
        return;
    }

    // A generation request can finish saving the questions before the final
    // status update reaches the database. Recover that state automatically.
    for(const q of data){
        if(q.status === "generating" && !q.generation_error){
            const { data: generatedQuestions, error: questionError } =
                await client.rpc("get_quiz_questions", {
                    p_quiz_challenge_id: q.id
                });

            if(!questionError &&
               Array.isArray(generatedQuestions) &&
               generatedQuestions.length >= Number(q.question_count || 0)){
                q.status = "ready";

                // Repair a stale GENERATING status when the quiz is actually
                // complete. This is safe because both participants may update
                // their own challenge under the existing RLS policy.
                const { error: repairError } = await client
                    .from("quiz_challenges")
                    .update({
                        status: "ready",
                        generation_error: null,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", q.id)
                    .eq("status", "generating");

                if(repairError){
                    console.warn("Quiz status repair failed:", repairError.message);
                }
            }
        }
    }

    list.innerHTML = "";

    for(const q of data){
        const sender = q.challenger_id === user.id;
        const otherId = sender ? q.opponent_id : q.challenger_id;

        let opponentName = "User";
        let opponentRivalryId = "-";

        const { data: p } = await client
            .from("profiles")
            .select("full_name,inter_rivalry_id")
            .eq("id", otherId)
            .maybeSingle();

        if(p){
            opponentName = p.full_name || "User";
            opponentRivalryId = p.inter_rivalry_id || "-";
        }

        const statusClass =
            q.status === "ready" ? "quiz-status-ready" :
            q.status === "generating" ? "quiz-status-generating" :
            q.generation_error ? "quiz-status-error" : "";

        const card = document.createElement("div");
        card.className = "quiz-battle-card";

        let action = "";

        if(q.status === "completed"){
            const resultText = q.result === "draw"
                ? "🤝 DRAW"
                : (q.winner_id === user.id ? "🏆 YOU WON" : "❌ YOU LOST");
            action = `
                <div class="action-row">
                    <button type="button" class="btn-3d-sm-white-glow" onclick="event.preventDefault(); event.stopPropagation(); showQuizFinalFromChallenge('${q.id}'); return false;">
                        ${resultText} • VIEW FINAL RESULT
                    </button>
                </div>`;
        } else if(q.status === "ready" || q.status === "active"){
            const battleStatus = await getQuizBattleStatus(q.id);
            if(battleStatus?.my_completed && !battleStatus?.opponent_completed){
                action = `
                    <div class="action-row">
                        <button type="button" class="btn-3d-sm-white-glow" disabled>
                            ⏳ WAITING FOR OPPONENT TO ATTEND
                        </button>
                    </div>`;
            } else if(battleStatus?.my_completed && battleStatus?.opponent_completed){
                action = `
                    <div class="action-row">
                        <button type="button" class="btn-3d-sm-white-glow" disabled>
                            ✅ BOTH PLAYERS HAVE ATTENDED
                        </button>
                    </div>`;
            } else {
                action = `
                    <div class="action-row">
                        <button type="button" class="btn-3d-sm-white-glow" onclick="event.preventDefault(); event.stopPropagation(); viewGeneratedQuiz('${q.id}'); return false;">
                            👀 ${q.status === "active" ? "ATTEND QUIZ" : "VIEW QUIZ"}
                        </button>
                    </div>`;
            }
        } else if(q.generation_error){
            action = `
                <div class="action-row">
                    <button class="btn-3d-sm-white-glow" onclick="retryQuizGeneration('${q.id}')">
                        🔄 RETRY GENERATION
                    </button>
                </div>`;
        } else if(q.status === "generating"){
            action = `
                <div class="action-row">
                    <button class="btn-3d-sm-white-glow" disabled>
                        ⏳ GEMINI GENERATING...
                    </button>
                </div>`;
        }

        card.innerHTML = `
            <h3>🤖 ${escapeHTML(q.course)} • Sem ${escapeHTML(q.semester)} • ${escapeHTML(q.subject)}</h3>
            <div class="quiz-battle-info">
                <strong>${sender ? "Opponent" : "Challenger"}:</strong> ${escapeHTML(opponentName)}
                <br><strong>ID:</strong> ${escapeHTML(opponentRivalryId)}
                <br><strong>Difficulty:</strong> ${escapeHTML(q.difficulty)}
                <br><strong>Questions:</strong> ${escapeHTML(q.question_count)}
                <br><strong>Time:</strong> ${escapeHTML(q.time_per_question)} seconds/question
                <br><strong>Status:</strong>
                <span class="status-pill ${statusClass}">
                    ${escapeHTML(q.status || "-")}
                </span>
                ${q.generation_error
                    ? `<br><strong style="color:#ff7675;">Generation error:</strong> ${escapeHTML(q.generation_error)}`
                    : ""}
            </div>
            ${action}
            ${sender ? `
                <div class="action-row" style="margin-top:8px;">
                    <button type="button" class="btn-3d-sm-white-glow" onclick="event.preventDefault(); event.stopPropagation(); deleteQuizBattle('${q.id}'); return false;">
                        🗑️ DELETE QUIZ
                    </button>
                </div>` : ""}
        `;

        list.appendChild(card);
    }

    // Keep the opponent's screen updated while Gemini is still working.
    if(quizGenerationPollTimer) clearInterval(quizGenerationPollTimer);
    const hasGenerating = data.some(q => q.status === "generating" && !q.generation_error);
    if(hasGenerating){
        quizGenerationPollTimer = setInterval(async () => {
            const { data: fresh } = await client
                .from("quiz_challenges")
                .select("status,generation_error")
                .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`);

            const stillGenerating = fresh?.some(q =>
                q.status === "generating" && !q.generation_error
            );

            if(stillGenerating){
                await loadQuizBattles();
            } else {
                clearInterval(quizGenerationPollTimer);
                quizGenerationPollTimer = null;
                await loadQuizBattles();
            }
        }, 5000);
    }
}

let activeQuizBattle = null;
let quizResultPollTimer = null;

let openingQuizBattle = false;

async function showQuizFinalFromChallenge(challengeId){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return alert("Please login first.");

    const { data: challenge, error } = await client
        .from("quiz_challenges")
        .select("id,challenger_id,opponent_id,course,semester,subject,question_count,status,winner_id,result,ranking_challenge_id")
        .eq("id", challengeId)
        .maybeSingle();

    if(error || !challenge) return alert("Could not load final quiz result.");
    if(user.id !== challenge.challenger_id && user.id !== challenge.opponent_id){
        return alert("You are not a participant in this quiz battle.");
    }
    if(challenge.status !== "completed"){
        return alert("This quiz battle is not completed yet.");
    }

    const { data: attempt } = await client
        .from("quiz_attempts")
        .select("id,score,correct_answers,wrong_answers,unanswered,completed_at")
        .eq("quiz_challenge_id", challengeId)
        .eq("user_id", user.id)
        .maybeSingle();

    activeQuizBattle = {
        challenge,
        questions: [],
        currentIndex: 0,
        selectedAnswers: {},
        answerStartedAt: null,
        timer: null,
        secondsLeft: 0,
        attemptId: attempt?.id || null,
        finished: true
    };

    await showQuizBattleResult(challengeId, attempt?.id || null, attempt?.score ?? 0, true);
    return true;
}

async function syncQuizResultToChallenge(challengeId, silent = true){
    try{
        const { data, error } = await client.rpc("sync_quiz_result_to_challenge", {
            p_quiz_challenge_id: challengeId
        });

        if(error){
            console.warn("AI quiz -> challenges sync failed:", error.message);
            if(!silent) alert("Quiz finished, but the Challenges sync failed: " + error.message);
            return null;
        }

        if(!data?.success){
            console.warn("AI quiz -> challenges sync rejected:", data?.error || "Unknown error");
            if(!silent) alert("Quiz finished, but the Challenges sync failed: " + (data?.error || "Unknown error"));
            return null;
        }

        return data;
    }catch(err){
        console.warn("AI quiz -> challenges sync exception:", err);
        if(!silent) alert("Quiz finished, but the Challenges sync failed: " + (err?.message || err));
        return null;
    }
}

async function finalizeQuizBattleClient(challengeId, silent = true){
    try{
        const { data, error } = await client.rpc("finalize_quiz_battle", {
            p_quiz_challenge_id: challengeId
        });

        if(error){
            if(!silent) alert("Could not finalize quiz: " + error.message);
            return null;
        }

        if(data?.success && data?.result){
            if(quizResultPollTimer){
                clearInterval(quizResultPollTimer);
                quizResultPollTimer = null;
            }

            const synced = await syncQuizResultToChallenge(challengeId, false);
            if(synced?.success){
                data.ranking_challenge_id = synced.ranking_challenge_id || synced.challenge_id;
            }

            return data;
        }
    }catch(err){
        if(!silent) alert("Could not finalize quiz: " + (err?.message || err));
    }
    return null;
}

function startQuizResultPolling(challengeId){
    if(quizResultPollTimer) clearInterval(quizResultPollTimer);
    quizResultPollTimer = setInterval(async () => {
        const result = await finalizeQuizBattleClient(challengeId, true);
        if(result && activeQuizBattle && activeQuizBattle.challenge?.id === challengeId){
            activeQuizBattle.challenge.status = "completed";
            activeQuizBattle.challenge.winner_id = result.winner_id;
            activeQuizBattle.challenge.result = result.result;
            await showQuizBattleResult(challengeId, activeQuizBattle.attemptId, null, true);
            await syncQuizResultToChallenge(challengeId, true);
        }
    }, 5000);
}

async function viewGeneratedQuiz(challengeId){
    if(openingQuizBattle) return false;
    openingQuizBattle = true;
    try {
    const { data: { user } } = await client.auth.getUser();
    if(!user) return alert("Please login first.");

    const { data: questions, error } = await client.rpc("get_quiz_questions", {
        p_quiz_challenge_id: challengeId
    });

    if(error){
        alert("Could not load quiz: " + error.message);
        return;
    }

    if(!questions?.length){
        alert("No generated questions found.");
        return;
    }

    const { data: challenge, error: challengeError } = await client
        .from("quiz_challenges")
        .select("id,challenger_id,opponent_id,course,semester,subject,question_count,time_per_question,status,winner_id,result,ranking_challenge_id")
        .eq("id", challengeId)
        .maybeSingle();

    if(challengeError || !challenge){
        alert("Could not load quiz battle details.");
        return;
    }

    if(user.id !== challenge.challenger_id && user.id !== challenge.opponent_id){
        alert("You are not a participant in this quiz battle.");
        return;
    }

    if(challenge.status === "completed"){
        const { data: ownAttempt } = await client
            .from("quiz_attempts")
            .select("id,score,correct_answers,wrong_answers,unanswered,completed_at")
            .eq("quiz_challenge_id", challengeId)
            .eq("user_id", user.id)
            .maybeSingle();

        activeQuizBattle = {
            challenge,
            questions: questions.map(q => ({ ...q, id: q.question_id })).sort((a,b) => Number(a.question_number) - Number(b.question_number)),
            currentIndex: 0,
            selectedAnswers: {},
            answerStartedAt: null,
            timer: null,
            secondsLeft: 0,
            attemptId: ownAttempt?.id || null,
            finished: true
        };
        await showQuizBattleResult(challengeId, ownAttempt?.id || null, ownAttempt?.score ?? 0, true);
        return true;
    }

    const quizHasEnoughQuestions =
        Array.isArray(questions) &&
        questions.length >= Number(challenge.question_count || 0);

    if(challenge.status !== "ready" &&
       challenge.status !== "active" &&
       challenge.status !== "completed" &&
       !(challenge.status === "generating" && quizHasEnoughQuestions)){
        alert("This quiz is not ready to play yet.");
        return;
    }

    activeQuizBattle = {
        challenge,
        questions: questions.map(q => ({ ...q, id: q.question_id })).sort((a,b) => Number(a.question_number) - Number(b.question_number)),
        currentIndex: 0,
        selectedAnswers: {},
        answerStartedAt: null,
        timer: null,
        secondsLeft: Number(challenge.time_per_question || 30),
        attemptId: null,
        finished: false
    };

    const { data: attempt, error: attemptError } = await client.rpc("start_quiz_attempt", {
        p_quiz_challenge_id: challengeId
    });

    if(attemptError){
        alert("Could not start quiz attempt: " + attemptError.message);
        activeQuizBattle = null;
        return;
    }

    activeQuizBattle.attemptId =
        attempt?.id ||
        attempt?.attempt_id ||
        (Array.isArray(attempt) ? attempt[0]?.id : null);

    if(!activeQuizBattle.attemptId){
        // Some RPC return shapes may expose the attempt through a direct query.
        const { data: existingAttempt } = await client
            .from("quiz_attempts")
            .select("id")
            .eq("quiz_challenge_id", challengeId)
            .eq("user_id", user.id)
            .maybeSingle();

        activeQuizBattle.attemptId = existingAttempt?.id || null;
    }

    if(!activeQuizBattle.attemptId){
        alert("Quiz attempt could not be created.");
        activeQuizBattle = null;
        return;
    }

    // If this player already finished, show their result instead of starting again.
    const { data: previousAttempt } = await client
        .from("quiz_attempts")
        .select("id,completed_at,score,correct_answers,wrong_answers,unanswered")
        .eq("id", activeQuizBattle.attemptId)
        .maybeSingle();

    if(previousAttempt?.completed_at){
        activeQuizBattle.finished = true;
        await showQuizBattleResult(challengeId, activeQuizBattle.attemptId);
        return;
    }

    // Move a ready battle to active when someone starts it.
    if(challenge.status === "ready"){
        await client
            .from("quiz_challenges")
            .update({ status: "active", updated_at: new Date().toISOString() })
            .eq("id", challengeId)
            .eq("status", "ready");
        activeQuizBattle.challenge.status = "active";
    }

    renderQuizQuestion();
    return true;
    } catch (err) {
        console.error("QUIZ OPEN ERROR:", err);
        alert("Could not open quiz: " + (err?.message || err));
        activeQuizBattle = null;
        return false;
    } finally {
        openingQuizBattle = false;
    }
}

function closeQuizBattle(){
    if(quizResultPollTimer){
        clearInterval(quizResultPollTimer);
        quizResultPollTimer = null;
    }
    if(activeQuizBattle?.timer){
        clearInterval(activeQuizBattle.timer);
    }
    activeQuizBattle = null;
    const overlay = document.getElementById("quizBattleOverlay");
    if(overlay) overlay.remove();
}

function renderQuizQuestion(){
    const battle = activeQuizBattle;
    if(!battle || battle.finished) return;

    if(battle.timer) clearInterval(battle.timer);

    const q = battle.questions[battle.currentIndex];
    if(!q){
        finishQuizBattle();
        return;
    }

    battle.secondsLeft = Number(battle.challenge.time_per_question || 30);
    battle.answerStartedAt = Date.now();

    let overlay = document.getElementById("quizBattleOverlay");
    if(!overlay){
        overlay = document.createElement("div");
        overlay.id = "quizBattleOverlay";
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.82);z-index:10000;padding:16px;overflow:auto;box-sizing:border-box;color:#fff;";
        document.body.appendChild(overlay);
    }

    const options = Array.isArray(q.options) ? q.options : [];
    const selected = battle.selectedAnswers[q.id];
    const isLast = battle.currentIndex === battle.questions.length - 1;

    overlay.innerHTML = `
        <div class="ir-quiz-panel" style="max-width:720px;width:100%;margin:20px auto;background:#111;border:2px solid #fff;border-radius:6px;padding:22px;color:#fff;box-sizing:border-box;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px;">
                <div>
                    <div class="ir-quiz-title" style="color:#fff;font-size:12px;font-weight:800;letter-spacing:0;">🤖 AI QUIZ BATTLE</div>
                    <h2 class="ir-quiz-subject" style="margin-top:5px;color:#fff;font-family:Georgia,'Times New Roman',serif;letter-spacing:0;">${escapeHTML(battle.challenge.subject)}</h2>
                </div>
                <div id="quizTimer" style="min-width:76px;text-align:center;padding:10px 12px;border:1px solid #111;border-radius:4px;font-size:22px;font-weight:900;color:#111;background:#f5f3ee;">${battle.secondsLeft}s</div>
            </div>

            <div class="ir-quiz-progress-track" style="height:6px;background:#333;border-radius:999px;overflow:hidden;margin-bottom:18px;">
                <div class="ir-quiz-progress-fill" style="height:100%;width:${((battle.currentIndex + 1) / battle.questions.length) * 100}%;background:#fff;border-radius:999px;"></div>
            </div>

            <div class="ir-quiz-progress-label" style="color:#fff;font-size:13px;margin-bottom:10px;font-weight:700;letter-spacing:0;">
                QUESTION ${battle.currentIndex + 1} OF ${battle.questions.length}
            </div>

            <div class="ir-quiz-question-text" style="font-size:20px;line-height:1.5;font-weight:700;margin-bottom:20px;color:#fff !important;letter-spacing:0;text-shadow:none;">
                ${escapeHTML(q.question_text)}
            </div>

            <div id="quizOptionsContainer" style="display:grid;gap:10px;color:#111;">
                ${options.map((option,index) => `
                    <button type="button"
                        class="quiz-battle-option ${selected === index ? 'selected' : ''}"
                        onclick="selectQuizAnswer(${index})">
                        <span style="font-weight:900;margin-right:8px;color:inherit;">${String.fromCharCode(65 + index)}.</span>
                        ${escapeHTML(option)}
                    </button>
                `).join("")}
            </div>

            <div style="display:flex;gap:10px;margin-top:20px;">
                <button type="button" class="quiz-exit-btn" style="flex:1;background:#fff;color:#111;border:1px solid #111;border-radius:4px;padding:14px;font-weight:800;letter-spacing:0;" onclick="closeQuizBattle()">EXIT</button>
                <button id="quizNextBtn" type="button" class="quiz-next-btn" style="flex:2;background:#111;color:#fff;border:1px solid #111;border-radius:4px;padding:14px;font-weight:800;letter-spacing:0;" onclick="submitCurrentQuizAnswer()">
                    ${isLast ? '🏆 SUBMIT QUIZ' : 'NEXT ➜'}
                </button>
            </div>
        </div>
    `;

    battle.timer = setInterval(() => {
        if(!activeQuizBattle || activeQuizBattle.finished) return;
        activeQuizBattle.secondsLeft--;
        const timer = document.getElementById("quizTimer");
        if(timer) timer.textContent = Math.max(0, activeQuizBattle.secondsLeft) + "s";
        if(activeQuizBattle.secondsLeft <= 0){
            clearInterval(activeQuizBattle.timer);
            activeQuizBattle.timer = null;
            submitCurrentQuizAnswer(true);
        }
    },1000);
}

function selectQuizAnswer(index){
    const battle = activeQuizBattle;
    if(!battle || battle.finished) return;
    const q = battle.questions[battle.currentIndex];
    battle.selectedAnswers[q.id] = index;

    document.querySelectorAll("#quizOptionsContainer .quiz-battle-option").forEach((btn,i) => {
        btn.classList.toggle("selected", i === index);
    });
}

async function submitCurrentQuizAnswer(autoSubmitted = false){
    const battle = activeQuizBattle;
    if(!battle || battle.finished) return;

    if(battle.timer){
        clearInterval(battle.timer);
        battle.timer = null;
    }

    const q = battle.questions[battle.currentIndex];
    const selected = Object.prototype.hasOwnProperty.call(battle.selectedAnswers,q.id)
        ? battle.selectedAnswers[q.id]
        : null;

    const timeLimit = Number(battle.challenge.time_per_question || 30);
    const elapsed = Math.max(0, Math.min(timeLimit, Math.round((Date.now() - battle.answerStartedAt) / 1000)));
    const timeTaken = autoSubmitted ? timeLimit : elapsed;

    const btn = document.getElementById("quizNextBtn");
    if(btn){ btn.disabled = true; btn.textContent = "SAVING..."; }

    const { error } = await client.rpc("submit_quiz_answer", {
        p_attempt_id: battle.attemptId,
        p_question_id: q.id,
        p_selected_option: selected === null ? -1 : selected,
        p_time_taken: timeTaken
    });

    if(error){
        alert("Could not submit answer: " + error.message);
        renderQuizQuestion();
        return;
    }

    if(battle.currentIndex >= battle.questions.length - 1){
        await finishQuizBattle();
        return;
    }

    battle.currentIndex++;
    renderQuizQuestion();
}

async function finishQuizBattle(){
    const battle = activeQuizBattle;
    if(!battle || battle.finished) return;

    battle.finished = true;
    if(battle.timer) clearInterval(battle.timer);
    battle.timer = null;

    const { data: scoreData, error } = await client.rpc("finish_quiz_attempt", {
        p_attempt_id: battle.attemptId
    });

    if(error){
        battle.finished = false;
        alert("Could not finish quiz: " + error.message);
        renderQuizQuestion();
        return;
    }

    const finalResult = await finalizeQuizBattleClient(battle.challenge.id, true);
    if(finalResult){
        battle.challenge.status = "completed";
        battle.challenge.winner_id = finalResult.winner_id;
        battle.challenge.result = finalResult.result;
        await showQuizBattleResult(battle.challenge.id,battle.attemptId,scoreData,true);
    }else{
        await showQuizBattleResult(battle.challenge.id,battle.attemptId,scoreData,false);
        startQuizResultPolling(battle.challenge.id);
    }
}

async function showQuizBattleResult(challengeId,attemptId,scoreData = null, finalResultKnown = false){
    const battle = activeQuizBattle;
    if(!battle) return;

    const { data: attempt } = await client
        .from("quiz_attempts")
        .select("id,quiz_challenge_id,user_id,score,correct_answers,wrong_answers,unanswered,completed_at")
        .eq("id",attemptId)
        .maybeSingle();

    const score = Number(attempt?.score ?? (typeof scoreData === "number" ? scoreData : scoreData?.score ?? 0));
    const correct = Number(attempt?.correct_answers || 0);
    const wrong = Number(attempt?.wrong_answers || 0);
    const unanswered = Number(attempt?.unanswered || Math.max(0,battle.questions.length - correct - wrong));

    const { data: { user } } = await client.auth.getUser();
    const overlay = document.getElementById("quizBattleOverlay");
    if(!overlay) return;

    overlay.innerHTML = `
        <div style="max-width:620px;width:100%;margin:50px auto;background:#121212;border:1px solid #333;border-radius:22px;padding:30px;text-align:center;">
            <div style="font-size:55px;margin-bottom:12px;">🏁</div>
            <div style="color:#111;font-weight:800;font-size:13px;letter-spacing:0;">QUIZ COMPLETED</div>
            <h1 style="margin:8px 0;">${escapeHTML(battle.challenge.subject)}</h1>
            <p style="color:#888;">Your attempt has been securely submitted.</p>

            <div style="font-size:64px;font-weight:900;margin:25px 0 5px;">${score}</div>
            <div style="color:#888;margin-bottom:25px;">POINTS</div>

            <div class="stat-grid" style="margin-bottom:22px;">
                <div class="rival-stat"><div class="num" style="color:#00b894;">${correct}</div><div class="lbl">CORRECT</div></div>
                <div class="rival-stat"><div class="num" style="color:#e17055;">${wrong}</div><div class="lbl">WRONG</div></div>
                <div class="rival-stat"><div class="num" style="color:#888;">${unanswered}</div><div class="lbl">UNANSWERED</div></div>
            </div>

            ${finalResultKnown || battle.challenge.status === "completed" ? `
                <div style="background:#0e0e0e;border:1px solid #292929;border-radius:12px;padding:18px;color:#aaa;line-height:1.7;margin-bottom:20px;">
                    <div style="font-size:22px;font-weight:900;color:#111;margin-bottom:8px;">
                        ${battle.challenge.result === "draw" ? "🤝 DRAW" : (battle.challenge.winner_id === user?.id ? "🏆 YOU WON" : "❌ YOU LOST")}
                    </div>
                    <div>Both players have completed the quiz.</div>
                    <div style="margin-top:6px;">The verified result has been sent to the INTER RIVALRY ranking system.</div>
                </div>` : `
                <div style="background:#0e0e0e;border:1px solid #292929;border-radius:12px;padding:14px;color:#aaa;line-height:1.6;margin-bottom:20px;">
                    Your quiz score is recorded. ⏳ Waiting for the opponent to finish. Once both players finish, the server will compare the scores and update the ranking automatically.
                </div>`}

            <button class="btn-3d-white-glow-gold" onclick="closeQuizBattle();loadQuizBattles();">BACK TO QUIZ BATTLES</button>
        </div>
    `;
}

// ==================== MY CHALLENGES ====================
async function loadMyChallenges(){
    const list = document.getElementById("myChallengesList");
    list.innerHTML = "<div class='empty-box'>Loading challenges...</div>";

    const { data: { user } } = await client.auth.getUser();
    if(!user) return;

    // Load BOTH normal challenges and AI Quiz Battles.
    // AI quizzes live in quiz_challenges, so they must be merged here
    // instead of expecting them to already exist in challenges.
    const [normalResult, quizResult] = await Promise.all([
        client.from("challenges")
            .select(`id,challenger_id,opponent_id,title,description,starts_at,ends_at,status,created_at,subcategory_id,rules,battlefield_type,community_id,subcategories(name,categories(name))`)
            .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
            .order("created_at",{ascending:false}),
        client.from("quiz_challenges")
            .select("id,challenger_id,opponent_id,course,semester,subject,topics,difficulty,question_count,time_per_question,status,generation_error,winner_id,result,ranking_challenge_id,subcategory_id,starts_at,ends_at,created_at,updated_at")
            .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
            .order("created_at",{ascending:false})
    ]);

    let data = normalResult.data || [];
    const quizData = (currentBattlefield === 'college' ? (quizResult.data || []) : []);
    let challengeScope;
    try { challengeScope = await getCurrentBattlefieldScope(user.id); } catch(e) {
        list.innerHTML = `<div class='empty-box'>Could not determine active profile: ${escapeHTML(e.message || e)}</div>`; return;
    }
    data = data.filter(c => challengeBelongsToBattlefield(c, challengeScope.battlefield, challengeScope.communityId, challengeScope.collegeId));

    if(normalResult.error && quizResult.error){
        list.innerHTML = `<div class='empty-box'>Unable to load challenges.<br>${escapeHTML(normalResult.error.message)}<br>${escapeHTML(quizResult.error.message)}</div>`;
        return;
    }

    // Repair/sync every completed AI quiz before rendering the normal Challenges board.
    // This also repairs older completed quizzes created before the sync feature existed.
    const completedQuizzes = quizData.filter(q => q.status === "completed");
    for(const q of completedQuizzes){
        const synced = await syncQuizResultToChallenge(q.id, true);
        if(synced?.success){
            q.ranking_challenge_id = synced.ranking_challenge_id || synced.challenge_id || q.ranking_challenge_id;
        }
    }

    // Re-read normal challenges after the sync because the RPC creates/updates rows there.
    const refreshedNormal = await client.from("challenges")
        .select(`id,challenger_id,opponent_id,title,description,starts_at,ends_at,status,created_at,subcategory_id,rules,battlefield_type,community_id,subcategories(name,categories(name))`)
        .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
        .order("created_at",{ascending:false});
    if(!refreshedNormal.error) data = (refreshedNormal.data || data).filter(c => challengeBelongsToBattlefield(c, challengeScope.battlefield, challengeScope.communityId, challengeScope.collegeId));

    list.innerHTML = "";

    // ---------- NORMAL CHALLENGES ----------
    for(const c of data){
        const sender = c.challenger_id === user.id;
        const otherId = sender ? c.opponent_id : c.challenger_id;
        const { data: p } = await client.from("profiles").select("full_name,inter_rivalry_id").eq("id",otherId).maybeSingle();
        const skill = c.subcategories ? ((c.subcategories.categories?.name ? c.subcategories.categories.name + " • " : "") + c.subcategories.name) : "Skill";
        const card = document.createElement("div"); card.className = "challenge-card";
        let actions = "";

        if(c.status === "pending" && !sender){
            actions = `<div class="action-row"><button class="btn-3d-sm-white-glow" onclick="updateChallengeStatus('${c.id}','accepted')">✅ ACCEPT</button><button class="btn-3d-sm-white-glow-danger" onclick="updateChallengeStatus('${c.id}','declined')">❌ REJECT</button></div>`;
        } else if(c.status === "pending" && sender){
            actions = `<div class="action-row"><button class="btn-3d-sm-white-glow-danger" onclick="deleteChallenge('${c.id}')">🗑️ DELETE</button></div>`;
        } else if(c.status === "accepted"){
            const game = c.rules?.game;
            if(c.rules?.team_challenge){
                const teamSize = `${c.rules.team_a_members?.length || 0}v${c.rules.team_b_members?.length || 0}`;
                const captainNote = c.rules.team_a_captain_id === user.id || c.rules.team_b_captain_id === user.id
                    ? "You are a captain for this match."
                    : "You are a player in this match.";
                actions = `<div class="action-row" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                    <span style="color:#00b894;font-size:13px;">👥 Random sports teams created: ${teamSize}. ${captainNote}</span>
                    <button class="btn-3d-sm-white-glow" onclick="openManualResult('${c.id}')">🏆 REPORT RESULT</button>
                </div>`;
            } else if(game === "ai_quiz" || c.rules?.ai_quiz === true){
                const quizId = c.rules?.ai_quiz_challenge_id;
                actions = quizId
                    ? `<div class="action-row" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                        <span style="color:#00b894;font-size:13px;">🤖 AI Quiz is ready. Both players will answer the same generated questions.</span>
                        <button class="btn-3d-sm-white-glow" onclick="openIntegratedQuizFromChallenge('${c.id}','${quizId}')">🤖 ATTEND QUIZ</button>
                    </div>`
                    : `<div class="action-row" style="margin-top:12px;"><span style="color:#aaa;font-size:13px;">⏳ AI Quiz is being prepared...</span></div>`;
            } else if(game === "chess") {
                actions = `<div class="action-row" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><span style="color:#00b894;font-size:13px;">♟️ Play on Chess.com. INTER RIVALRY will automatically check the result in the background.</span><button class="btn-3d-sm-white-glow" onclick="checkChessResult('${c.id}')">🔄 CHECK NOW</button></div>`;
            } else if(game === "freefire") {
                actions = sender
                    ? `<div class="action-row" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;"><span style="color:#111;font-size:13px;">🔥 Free Fire: the challenger submits the final result screenshot.</span><button class="btn-3d-sm-white-glow" onclick="openFreeFireResult('${c.id}')">📸 SUBMIT RESULT</button></div><div id="ffStatus_${c.id}" class="ff-status"></div>`
                    : `<div class="action-row" style="margin-top:12px;"><span style="color:#aaa;font-size:13px;">🔥 Free Fire: waiting for the challenger to submit the final result screenshot.</span></div><div id="ffStatus_${c.id}" class="ff-status"></div>`;
            } else {
                actions = `<div class="action-row" style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
                    <span style="color:#00b894;font-size:13px;">🎮 Manual result reporting — report your result after the game.</span>
                    <button class="btn-3d-sm-white-glow" onclick="openManualResult('${c.id}')">🏆 REPORT RESULT</button>
                </div>`;
            }
        } else if(c.status === "completed"){
            const teamResult = getTeamParticipantResult(c.rules, user.id);
            let winner = c.rules?.team_challenge
                ? (teamResult || "Completed")
                : (c.rules?.result === "draw" ? "Draw" : c.rules?.winner_id === user.id ? "You won 🎉" : (c.rules?.winner_name || "Opponent won"));
            actions = `<div class="challenge-info" style="margin-top:12px"><strong>Result:</strong> ${escapeHTML(winner)}${c.rules?.player1_score !== undefined ? `<br><strong>Score:</strong> ${escapeHTML(c.rules.player1_score)} - ${escapeHTML(c.rules.player2_score)}` : ""}</div>`;
        }

        const teamLineup = c.rules?.team_challenge ? getTeamChallengeDisplay(c.rules) : "";

        card.innerHTML = `<h3>⚔️ ${escapeHTML(c.title)}</h3><div class="challenge-info">
            <strong>${sender ? "Opponent" : "Challenger"}:</strong> ${escapeHTML(p?.full_name || "User")}
            <br><strong>ID:</strong> ${escapeHTML(p?.inter_rivalry_id || "-")}
            <br><strong>Skill:</strong> ${escapeHTML(skill)}
            <br><strong>Status:</strong> <span class="status-pill status-${escapeHTML(c.status || "")}">${escapeHTML(c.status || "-")}</span>
            <br><strong>Starts:</strong> ${formatDate(c.starts_at)}
            <br><strong>Ends:</strong> ${formatDate(c.ends_at)}${c.description ? `<br><strong>Description:</strong> ${escapeHTML(c.description)}` : ""}
        </div>${teamLineup}${actions}`;
        list.appendChild(card);
    }

    // ---------- INTEGRATED AI QUIZ CHALLENGES ----------
    // AI quizzes are now represented by their normal challenges.
    // quizData is only loaded above so older completed quizzes can still be repaired/synced.

    if(!data.length){
        list.innerHTML = "<div class='empty-box'>No challenges yet.</div>";
    }

    // Free Fire verification status for normal challenges.
    for(const c of data){
        if(c.rules?.game === "freefire" && c.status === "accepted"){
            const el = document.getElementById(`ffStatus_${c.id}`);
            if(el) await loadFreeFireVerification(c.id,el);
        }
    }

    startChessAutoMonitor();
}

async function openIntegratedQuizFromChallenge(challengeId, quizId){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return alert("Please login first.");

    const { data: challenge, error } = await client
        .from("challenges")
        .select("id,challenger_id,opponent_id,status,rules,title")
        .eq("id", challengeId)
        .maybeSingle();

    if(error || !challenge) return alert("Could not load the challenge.");
    if(![challenge.challenger_id, challenge.opponent_id].includes(user.id)) return alert("You are not part of this challenge.");
    if(challenge.status !== "accepted" && challenge.status !== "completed") return alert("Accept the challenge before starting the quiz.");

    // If generation is still pending, check the quiz status and recover generation if necessary.
    const { data: quiz, error: quizError } = await client
        .from("quiz_challenges")
        .select("id,status,generation_error")
        .eq("id", quizId)
        .maybeSingle();

    if(quizError || !quiz) return alert("Could not load the AI quiz.");

    if(quiz.generation_error){
        return alert("AI quiz generation failed: " + quiz.generation_error);
    }

    if(["pending","generating"].includes(quiz.status)){
        return alert("🤖 The AI quiz is still being generated. Please try again in a few seconds.");
    }

    await viewGeneratedQuiz(quizId);
}


// ==================== UPDATE CHALLENGE STATUS ====================
async function updateChallengeStatus(challengeId, status){
    const label = status === "accepted" ? "accept" : "reject";
    if(!confirm(`Are you sure you want to ${label} this challenge?`)) return;
    
    const { data: { user } } = await client.auth.getUser(); 
    if(!user) return;
    
    const { data: c } = await client
        .from("challenges")
        .select("opponent_id,status,challenger_id")
        .eq("id",challengeId)
        .single();
    
    if(!c || c.opponent_id !== user.id || c.status !== "pending") 
        return alert("Cannot update this challenge.");
    
    const { error } = await client.from("challenges").update({ status }).eq("id",challengeId);
    if(error) return alert("Error: " + error.message);
    
    if(status === "accepted"){
        await client.from("notifications").insert([
            { 
                user_id: c.challenger_id, 
                title: "🎯 Challenge Accepted!", 
                message: `${user.email} accepted your challenge!` 
            },
            { 
                user_id: c.opponent_id, 
                title: "🎯 Challenge Accepted!", 
                message: `You accepted the challenge!` 
            }
        ]);
    }
    
    await loadMyChallenges();
}


// ==================== MANUAL RESULT ====================
async function openManualResult(challengeId){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ alert("Please login first."); return; }

    const { data: challenge, error } = await client.from("challenges")
        .select("id,challenger_id,opponent_id,title,status,rules")
        .eq("id", challengeId).single();

    if(error || !challenge) return alert("Challenge not found.");
    if(![challenge.challenger_id, challenge.opponent_id].includes(user.id)) return alert("You are not part of this challenge.");
    if(challenge.status !== "accepted") return alert("This challenge must be accepted before reporting a result.");

    const game = challenge.rules?.game;
    if(game === "chess") return alert("Chess results are checked automatically through Chess.com.");
    if(game === "freefire") return openFreeFireResult(challengeId);

    const isTeamChallenge = challenge.rules?.team_challenge === true;
    const teamA = challenge.rules?.team_a_members || [];
    const teamB = challenge.rules?.team_b_members || [];

    if(isTeamChallenge && ![challenge.rules?.team_a_captain_id, challenge.rules?.team_b_captain_id].includes(user.id)){
        return alert("For a team challenge, only the two captains can report the final team result.");
    }

    const overlay=document.createElement("div");
    overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;justify-content:center;align-items:center;z-index:10000;padding:20px;overflow:auto;";
    const modal=document.createElement("div");
    modal.style.cssText="background:#171717;border:1px solid #333;border-radius:20px;padding:24px;max-width:520px;width:100%;max-height:90vh;overflow:auto;";
    modal.innerHTML=`
      <h2 style="margin:0 0 8px;color:#fff;">🎮 Manual Result</h2>
      <p style="color:#999;margin:0 0 20px;">${escapeHTML(challenge.title)}</p>
      <div class="input-group">
        <label>${isTeamChallenge ? "Match Result" : "Result"}</label>
        <select id="manualResultSelect">
          <option value="">Select result</option>
          ${isTeamChallenge
            ? `<option value="team_challenger_win">🏆 TEAM A / CHALLENGER WON</option>
               <option value="team_opponent_win">🏆 TEAM B / OPPONENT WON</option>
               <option value="draw">🤝 DRAW</option>`
            : `<option value="win">🏆 I WON</option>
               <option value="loss">😔 I LOST</option>
               <option value="draw">🤝 DRAW</option>`}
        </select>
      </div>
      ${isTeamChallenge ? `
      <div style="margin:10px 0;padding:12px;background:#111;border:1px solid #333;border-radius:12px;color:#aaa;font-size:13px;line-height:1.6;">
        <strong style="color:#fff;">Team A:</strong> ${teamMemberNames(teamA)}<br>
        <strong style="color:#fff;">Team B:</strong> ${teamMemberNames(teamB)}
        <br><span style="color:#888;">Every player on the winning team receives an individual win; every player on the losing team receives an individual loss. A draw gives every player one draw.</span>
      </div>` : ""}
      <div class="input-group">
        <label>Your score (optional)</label>
        <input id="manualMyScore" type="text" maxlength="40" placeholder="Example: 3 - 1">
      </div>
      <div class="input-group">
        <label>Opponent score (optional)</label>
        <input id="manualOpponentScore" type="text" maxlength="40" placeholder="Example: 1 - 3">
      </div>
      <div class="action-row" style="margin-top:16px;display:flex;gap:10px;">
        <button id="manualSubmitBtn" class="btn-3d-sm-white-glow">SUBMIT RESULT</button>
        <button id="manualCancelBtn" class="btn-3d-sm-white-glow-danger">CANCEL</button>
      </div>`;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    modal.querySelector("#manualCancelBtn").onclick=()=>overlay.remove();
    modal.querySelector("#manualSubmitBtn").onclick=async()=>{
        const result=modal.querySelector("#manualResultSelect").value;
        if(!result) return alert("Please select a result.");

        const myScore=modal.querySelector("#manualMyScore").value.trim();
        const opponentScore=modal.querySelector("#manualOpponentScore").value.trim();
        const isChallenger=challenge.challenger_id===user.id;

        const rules={...(challenge.rules||{}), result, result_submitted_by:user.id, result_submitted_at:new Date().toISOString()};

        if(isTeamChallenge){
            rules.team_result = result;
            rules.winner_id = result === "draw" ? null : (result === "team_challenger_win" ? challenge.challenger_id : challenge.opponent_id);
            rules.team_winner_member_ids = result === "draw"
                ? []
                : (result === "team_challenger_win" ? teamA.map(m => m.id || m.user_id) : teamB.map(m => m.id || m.user_id));
            rules.team_loser_member_ids = result === "draw"
                ? []
                : (result === "team_challenger_win" ? teamB.map(m => m.id || m.user_id) : teamA.map(m => m.id || m.user_id));
            rules.team_draw_member_ids = result === "draw"
                ? [...teamA, ...teamB].map(m => m.id || m.user_id)
                : [];
            if(myScore) rules.team_a_score = myScore;
            if(opponentScore) rules.team_b_score = opponentScore;
        }else{
            const winnerId=result === "draw" ? null : (result === "win" ? user.id : (isChallenger ? challenge.opponent_id : challenge.challenger_id));
            rules.winner_id=winnerId;
            if(myScore) rules.my_score=myScore;
            if(opponentScore) rules.opponent_score=opponentScore;
            if(myScore || opponentScore){
                if(isChallenger){ rules.player1_score=myScore; rules.player2_score=opponentScore; }
                else { rules.player1_score=opponentScore; rules.player2_score=myScore; }
            }
        }

        const { error: saveError }=await client.from("challenges").update({status:"completed",rules}).eq("id",challengeId);
        if(saveError) return alert("Could not save result: " + saveError.message);

        overlay.remove();
        alert(isTeamChallenge
            ? "✅ Team result submitted! Every player will receive the appropriate individual win/loss/draw in the sports ranking."
            : "✅ Result submitted successfully!");
        await loadMyChallenges();
    };
}

// ==================== FREE FIRE SCREENSHOT RESULT ====================
async function openFreeFireResult(challengeId){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ alert("Please login first."); return; }

    const { data: challenge, error } = await client.from("challenges")
        .select("id,challenger_id,opponent_id,title,status,rules")
        .eq("id", challengeId).single();

    if(error || !challenge) return alert("Challenge not found.");
    if(![challenge.challenger_id, challenge.opponent_id].includes(user.id)) return alert("You are not part of this challenge.");
    if(challenge.challenger_id !== user.id) return alert("Only the challenger can submit the Free Fire result screenshot.");
    if(challenge.status !== "accepted") return alert("This challenge must be accepted before reporting a result.");
    if(challenge.rules?.game !== "freefire") return alert("This is not a Free Fire challenge.");

    const overlay=document.createElement("div");
    overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.88);display:flex;justify-content:center;align-items:center;z-index:10000;padding:20px;overflow:auto;";
    const modal=document.createElement("div");
    modal.style.cssText="background:#171717;border:1px solid #333;border-radius:20px;padding:24px;max-width:520px;width:100%;max-height:90vh;overflow:auto;";
    modal.innerHTML=`
      <h2 style="margin:0 0 8px;color:#fff;">🔥 Free Fire Result</h2>
      <p style="color:#999;margin:0 0 20px;">${escapeHTML(challenge.title)}</p>
      <div class="input-group">
        <label>Result</label>
        <select id="ffResultSelect">
          <option value="">Select result</option>
          <option value="win">🏆 I WON</option>
          <option value="loss">😔 I LOST</option>
          <option value="draw">🤝 DRAW</option>
        </select>
      </div>
      <div class="input-group">
        <label>Your score / placement (optional)</label>
        <input id="ffMyScore" type="text" maxlength="40" placeholder="Example: 8 kills / 1st place">
      </div>
      <div class="input-group">
        <label>Opponent score / placement (optional)</label>
        <input id="ffOpponentScore" type="text" maxlength="40" placeholder="Example: 5 kills / 2nd place">
      </div>
      <div class="input-group">
        <label>Final result screenshot</label>
        <input id="ffScreenshot" type="file" accept="image/*">
        <img id="ffPreview" class="ff-preview" alt="Screenshot preview">
      </div>
      <div id="ffSubmitMsg" class="ff-status"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;">
        <button id="ffSubmitBtn" class="btn-3d-white-glow">📤 SUBMIT</button>
        <button id="ffCancelBtn" class="btn-3d-sm-white-glow-danger">❌ CANCEL</button>
      </div>`;
    overlay.appendChild(modal); document.body.appendChild(overlay);

    const fileInput=modal.querySelector("#ffScreenshot");
    const preview=modal.querySelector("#ffPreview");
    fileInput.addEventListener("change",()=>{
        const f=fileInput.files?.[0];
        if(!f){preview.style.display="none";return;}
        if(f.size>8*1024*1024){alert("Screenshot must be 8 MB or smaller.");fileInput.value="";preview.style.display="none";return;}
        preview.src=URL.createObjectURL(f); preview.style.display="block";
    });
    modal.querySelector("#ffCancelBtn").onclick=()=>overlay.remove();
    overlay.addEventListener("click",e=>{if(e.target===overlay)overlay.remove();});

    modal.querySelector("#ffSubmitBtn").onclick=async function(){
        const result=modal.querySelector("#ffResultSelect").value;
        const file=fileInput.files?.[0];
        const msg=modal.querySelector("#ffSubmitMsg");
        if(!result) return msg.textContent="Select the result.";
        if(!file) return msg.textContent="Upload the final-result screenshot.";
        if(!file.type.startsWith("image/")) return msg.textContent="Please select an image.";
        if(file.size>8*1024*1024) return msg.textContent="Screenshot must be 8 MB or smaller.";

        this.disabled=true; this.textContent="⏳ UPLOADING...";
        msg.textContent="Uploading screenshot securely...";

        const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"") || "jpg";
        const path=`${challengeId}/${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError }=await client.storage.from("challenge-results").upload(path,file,{upsert:false,contentType:file.type});
        if(uploadError){
            console.error(uploadError);
            msg.textContent="Upload failed: "+uploadError.message;
            this.disabled=false; this.textContent="📤 SUBMIT"; return;
        }

        const myScore=modal.querySelector("#ffMyScore").value.trim()||null;
        const opponentScore=modal.querySelector("#ffOpponentScore").value.trim()||null;

        const { data, error }=await client.rpc("submit_freefire_result",{
            p_challenge_id:challengeId,
            p_result:result,
            p_storage_path:path,
            p_my_score:myScore,
            p_opponent_score:opponentScore
        });

        if(error){
            console.error(error);
            await client.storage.from("challenge-results").remove([path]);
            msg.textContent="Could not submit result: "+error.message;
            this.disabled=false; this.textContent="📤 SUBMIT"; return;
        }

        msg.textContent="✅ Screenshot submitted. Waiting for the opponent to verify the result.";
        setTimeout(()=>{overlay.remove();loadMyChallenges();},900);
    };
}

async function loadFreeFireVerification(challengeId, container){
    if(!container) return;
    const { data:{user} }=await client.auth.getUser(); if(!user) return;
    const { data: c }=await client.from("challenges").select("id,challenger_id,opponent_id,status,rules").eq("id",challengeId).maybeSingle();
    if(!c || c.rules?.game!=="freefire") return;

    const { data: rows, error }=await client.from("challenge_results")
        .select("id,challenge_id,submitted_by,result_data,verification_status,submitted_at,verified_at")
        .eq("challenge_id",challengeId).order("submitted_at",{ascending:false});
    if(error) return;

    const mine=rows?.find(r=>r.submitted_by===user.id);
    const other=rows?.find(r=>r.submitted_by!==user.id);

    if(mine && mine.verification_status==="pending"){
        container.innerHTML="🟡 Your screenshot is submitted. Waiting for the opponent to verify the result.";
    } else if(other && other.verification_status==="pending"){
        container.innerHTML=`<button class="btn-3d-sm-white-glow" onclick="openFreeFireVerification('${challengeId}','${other.id}')">🔎 VERIFY OPPONENT RESULT</button>`;
    } else if(mine?.verification_status==="disputed" || other?.verification_status==="disputed"){
        container.innerHTML="⚠️ Result disputed. The challenge needs review.";
    } else if(c.status==="completed"){
        container.innerHTML="✅ Free Fire result verified and recorded.";
    }
}

async function openFreeFireVerification(challengeId,resultId){
    const { data:{user} }=await client.auth.getUser(); if(!user) return;
    const { data: row, error}=await client.from("challenge_results")
      .select("id,submitted_by,result_data,verification_status,submitted_at")
      .eq("id",resultId).single();
    if(error || !row) return alert("Result submission not found.");
    const { data: c}=await client.from("challenges").select("id,challenger_id,opponent_id,title,status,rules").eq("id",challengeId).single();
    if(!c || ![c.challenger_id,c.opponent_id].includes(user.id)) return alert("You are not part of this challenge.");
    if(row.submitted_by===user.id) return alert("You cannot verify your own submission.");
    if(row.verification_status!=="pending") return alert("This submission has already been processed.");

    const rd=row.result_data||{};
    let signedUrl=null;
    if(rd.storage_path){
      const s=await client.storage.from("challenge-results").createSignedUrl(rd.storage_path,3600);
      signedUrl=s.data?.signedUrl||null;
    }

    const overlay=document.createElement("div");
    overlay.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.9);display:flex;justify-content:center;align-items:center;z-index:10000;padding:20px;overflow:auto;";
    const modal=document.createElement("div");
    modal.style.cssText="background:#171717;border:1px solid #333;border-radius:20px;padding:24px;max-width:620px;width:100%;max-height:92vh;overflow:auto;";
    modal.innerHTML=`
      <h2 style="color:#fff;margin:0 0 8px;">🔎 Verify Free Fire Result</h2>
      <p style="color:#999;">Review the final-result screenshot carefully.</p>
      ${signedUrl?`<img src="${signedUrl}" alt="Final result screenshot" style="width:100%;max-height:55vh;object-fit:contain;background:#000;border:1px solid #333;border-radius:12px;margin:12px 0;">`:"<div class='empty-box'>Screenshot unavailable.</div>"}
      <div class="ff-result-box">
        <strong>Reported result:</strong> ${escapeHTML(rd.result||"-")}<br>
        <strong>Reported score:</strong> ${escapeHTML(rd.my_score||"-")} vs ${escapeHTML(rd.opponent_score||"-")}
      </div>
      <div id="ffVerifyMsg" class="ff-status"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;">
        <button id="ffApproveBtn" class="btn-3d-white-glow">✅ VERIFY</button>
        <button id="ffDisputeBtn" class="btn-3d-sm-white-glow-danger">⚠️ DISPUTE</button>
      </div>`;
    overlay.appendChild(modal);document.body.appendChild(overlay);
    overlay.addEventListener("click",e=>{if(e.target===overlay)overlay.remove();});

    modal.querySelector("#ffApproveBtn").onclick=async function(){
      if(!confirm("Verify this screenshot and record the reported result?")) return;
      this.disabled=true; modal.querySelector("#ffDisputeBtn").disabled=true;
      const {error}=await client.rpc("verify_freefire_result",{p_result_id:resultId});
      if(error){alert("Verification failed:\n"+error.message);this.disabled=false;modal.querySelector("#ffDisputeBtn").disabled=false;return;}
      overlay.remove(); await loadMyChallenges();
    };
    modal.querySelector("#ffDisputeBtn").onclick=async function(){
      if(!confirm("Dispute this result? It will not be counted as completed.")) return;
      this.disabled=true; modal.querySelector("#ffApproveBtn").disabled=true;
      const {error}=await client.rpc("dispute_freefire_result",{p_result_id:resultId});
      if(error){alert("Could not dispute:\n"+error.message);this.disabled=false;modal.querySelector("#ffApproveBtn").disabled=false;return;}
      overlay.remove(); await loadMyChallenges();
    };
}

// ==================== CHESS.COM AUTO RESULT ====================
let chessAutoMonitorStarted = false;
let chessAutoMonitorRunning = false;
const CHESS_AUTO_CHECK_INTERVAL = 15 * 60 * 1000; // 15 minutes

async function checkChessResult(challengeId, silent = false){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return;

    const { data: challenge, error } = await client.from("challenges")
        .select("id,challenger_id,opponent_id,status,starts_at,ends_at,created_at,rules")
        .eq("id", challengeId).single();
    if(error || !challenge) { if(!silent) alert("Challenge not found."); return false; }
    if(![challenge.challenger_id, challenge.opponent_id].includes(user.id)) { if(!silent) alert("You are not part of this challenge."); return false; }
    if(!["accepted","active"].includes(challenge.status)) { if(!silent) alert("This challenge is not ready for result checking."); return false; }
    if(challenge.rules?.game !== "chess") { if(!silent) alert("This is not a Chess.com challenge."); return false; }

    const { data: players, error: playerError } = await client.from("profiles")
        .select("id,chess_com_username")
        .in("id", [challenge.challenger_id, challenge.opponent_id]);
    if(playerError) { if(!silent) alert("Could not load the saved Chess.com usernames."); return false; }

    const challenger = (players || []).find(p => p.id === challenge.challenger_id);
    const opponent = (players || []).find(p => p.id === challenge.opponent_id);
    if(!challenger?.chess_com_username || !opponent?.chess_com_username){
        if(!silent) alert("Both players must save their Chess.com usernames before the result can be checked.");
        return false;
    }

    const status = document.querySelector(`[onclick="checkChessResult('${challengeId}')"]`);
    if(status){
        status.disabled = true;
        status.textContent = "⏳ CHECKING...";
    }

    const resetButton = () => {
        if(status){
            status.disabled = false;
            status.textContent = "🔄 CHECK CHESS RESULT";
        }
    };

    try {
        const usernameA = challenger.chess_com_username.trim();
        const usernameB = opponent.chess_com_username.trim();
        const a = usernameA.toLowerCase();
        const b = usernameB.toLowerCase();

        // Build the exact months covered by the challenge, plus one month on
        // each side. This is more reliable than guessing the last few months.
        const baseStart = new Date(challenge.starts_at || challenge.created_at || Date.now());
        const baseEnd = new Date(challenge.ends_at || challenge.starts_at || challenge.created_at || Date.now());
        const firstMonth = new Date(Date.UTC(baseStart.getUTCFullYear(), baseStart.getUTCMonth(), 1));
        const lastMonth = new Date(Date.UTC(baseEnd.getUTCFullYear(), baseEnd.getUTCMonth(), 1));
        firstMonth.setUTCMonth(firstMonth.getUTCMonth() - 1);
        lastMonth.setUTCMonth(lastMonth.getUTCMonth() + 1);

        const months = [];
        const cursor = new Date(firstMonth);
        while(cursor <= lastMonth && months.length < 6){
            months.push(`${cursor.getUTCFullYear()}/${String(cursor.getUTCMonth()+1).padStart(2,'0')}`);
            cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }

        // PubAPI is read-only and Chess.com documents that responses can be
        // cached for up to 12 hours. We therefore search broadly and show a
        // retry message instead of treating a temporary miss as a failure.
        const usernames = [...new Set([usernameA, usernameB])];
        const seen = new Set();
        const games = [];
        const apiErrors = [];

        for(const username of usernames){
            for(const ym of months){
                const url = `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${ym}`;
                try{
                    const response = await fetch(url, {
                        headers: { "Accept": "application/json" },
                        cache: "no-store"
                    });
                    if(response.status === 429){
                        apiErrors.push("429");
                        continue;
                    }
                    if(!response.ok) continue;
                    const json = await response.json();
                    for(const game of (json.games || [])){
                        const key = game.uuid || game.url || `${game.end_time || game.start_time || ''}-${game.white?.username || ''}-${game.black?.username || ''}`;
                        if(!seen.has(key)){
                            seen.add(key);
                            games.push(game);
                        }
                    }
                }catch(err){
                    console.warn("Chess.com API request failed:", url, err);
                }
            }
        }

        // Allow a generous window around the scheduled challenge because the
        // actual Chess.com game may start before/after the scheduled time.
        const startMs = baseStart.getTime() - 24 * 3600000;
        const endMs = baseEnd.getTime() + 24 * 3600000;

        const matches = games.filter(g => {
            const w = (g.white?.username || '').toLowerCase();
            const bl = (g.black?.username || '').toLowerCase();
            const samePlayers = (w === a && bl === b) || (w === b && bl === a);
            const rawTime = Number(g.end_time || g.start_time || 0);
            const t = rawTime * 1000;
            return samePlayers && t >= startMs && t <= endMs;
        }).sort((x,y) => Number(y.end_time || y.start_time || 0) - Number(x.end_time || x.start_time || 0));

        if(!matches.length){
            resetButton();
            if(apiErrors.includes("429")){
                    if(!silent) alert("Chess.com is temporarily rate-limiting the API. The automatic checker will try again later.");
                return false;
            }
            if(!silent) alert("⏳ The game is not visible in Chess.com's public API yet. The automatic checker will keep trying in the background.");
            return false;
        }

        const game = matches[0];
        const whiteUsername = (game.white?.username || '').toLowerCase();
        const blackUsername = (game.black?.username || '').toLowerCase();
        const whiteWin = game.white?.result === "win";
        const blackWin = game.black?.result === "win";

        let winnerId = null;
        let result = "draw";
        if(whiteWin || blackWin){
            const winnerUsername = whiteWin ? whiteUsername : blackUsername;
            winnerId = winnerUsername === a ? challenge.challenger_id : challenge.opponent_id;
            result = "win";
        }

        const { error: saveError } = await client.rpc("record_chess_result", {
            p_challenge_id: challengeId,
            p_result: result,
            p_winner_id: winnerId,
            p_game_url: game.url || null,
            p_game_id: game.uuid || null,
            p_player1_score: whiteWin ? 1 : blackWin ? 0 : 0.5,
            p_player2_score: blackWin ? 1 : whiteWin ? 0 : 0.5
        });

        if(saveError){
            resetButton();
            console.error(saveError);
            if(!silent) alert("The Chess.com game was found, but INTER RIVALRY could not save the result. Check the Supabase RPC setup.");
            return false;
        }

        if(!silent) alert(`✅ Chess result found and recorded!\n\n${game.url ? "Game: " + game.url : "Chess.com game detected."}`);
        await loadMyChallenges();
        return true;
    }catch(err){
        console.error("Chess result check failed:", err);
        resetButton();
        if(!silent) alert("Could not check Chess.com right now. Please try again later.");
        return false;
    }
}

async function autoCheckChessChallenges(){
    if(chessAutoMonitorRunning) return;
    chessAutoMonitorRunning = true;
    try{
        const { data: { user } } = await client.auth.getUser();
        if(!user) return;

        const { data: challenges, error } = await client.from("challenges")
            .select("id,challenger_id,opponent_id,status,starts_at,ends_at,created_at,rules")
            .or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`)
            .in("status", ["accepted","active"]);

        if(error) {
            console.warn("Chess background monitor could not load challenges:", error);
            return;
        }

        const chessChallenges = (challenges || []).filter(c => c.rules?.game === "chess" && !c.rules?.result);
        for(const c of chessChallenges){
            // Do not hammer Chess.com. One challenge is checked at a time, and
            // the monitor itself runs only every 15 minutes.
            const found = await checkChessResult(c.id, true);
            if(found) break;
        }
    }catch(err){
        console.warn("Chess background monitor failed:", err);
    }finally{
        chessAutoMonitorRunning = false;
    }
}

function startChessAutoMonitor(){
    if(chessAutoMonitorStarted) return;
    chessAutoMonitorStarted = true;

    // First pass shortly after challenges are loaded, then continue silently.
    setTimeout(() => autoCheckChessChallenges(), 3000);
    setInterval(() => autoCheckChessChallenges(), CHESS_AUTO_CHECK_INTERVAL);
}

// ==================== DELETE CHALLENGE ====================
async function deleteChallenge(challengeId){
    if(!confirm("Delete this challenge?")) return;
    const { data: { user } } = await client.auth.getUser(); if(!user) return;
    const { error } = await client.from("challenges").delete().eq("id",challengeId).eq("challenger_id",user.id);
    if(error) return alert("Error: " + error.message);
    await loadMyChallenges();
}

// ==================== CR ELECTION SYSTEM ====================
let currentCrElection = null;
let currentCrCandidates = [];

function closeCrElectionModal(){ const el=document.getElementById('crElectionModal'); if(el) el.style.display='none'; }

async function getCrElectionContext(){
    const membership=currentClassMembership||await getMyClassMembership();
    if(!membership) return null;
    const {data:{user}}=await client.auth.getUser();
    if(!user) return null;
    return {membership,user};
}

async function loadCrElection(){
    const ctx=await getCrElectionContext();
    const status=document.getElementById('crElectionStatus');
    const summary=document.getElementById('crElectionSummary');

    currentCrElection=null;
    currentCrCandidates=[];

    if(!ctx){
        if(status)status.textContent='Join and get approved to participate.';
        if(summary)summary.textContent='';
        return;
    }

    const m=ctx.membership;

    // Fetch open elections first. The old code used exact .eq() filters,
    // which can hide a valid election because Supabase .eq() is exact-match.
    const {data:elections,error}=await client
        .from('cr_elections')
        .select('*')
        .eq('is_active',true)
        .eq('status','open')
        .order('created_at',{ascending:false});

    console.log('CR elections:', elections, error);

    if(error){
        console.error('CR election load error:', error);
        if(status)status.textContent='Could not load election';
        if(summary)summary.textContent=error.message || 'Database error while loading the election.';
        return;
    }

    // Match the student's active class in JavaScript using normalized values.
    // This avoids exact database filtering on specialization.
    const normalizeText = value => String(value ?? '').trim().toLowerCase();

    const election=(elections||[]).find(e =>
        String(e.college_id) === String(m.college_id) &&
        normalizeText(e.course) === normalizeText(m.course) &&
        Number(e.year_of_study) === Number(m.year_of_study) &&
        normalizeText(e.specialization) === normalizeText(m.specialization)
    );

    if(!election){
        if(status)status.textContent='No active election';
        if(summary){
            summary.textContent='No election has been opened for your class yet.';
        }
        console.warn('No matching CR election for membership:',m,'Available elections:',elections);
        return;
    }

    currentCrElection=election;

    // Candidate visibility is controlled by the cr_nominations RLS policy.
    // Do not join profiles here: a separate profile RLS rule must never hide
    // an otherwise valid approved candidate from the voting list.
    const {data:candidateRows,error:candidateError}=await client
        .from('cr_nominations')
        .select('id,user_id,statement,status,created_at')
        .eq('election_id',election.id)
        .eq('status','approved')
        .order('created_at');

    if(candidateError){
        console.error('CR approved candidates load error:',candidateError);
        currentCrCandidates=[];
    }else{
        const candidateIds=(candidateRows||[]).map(c=>c.user_id).filter(Boolean);
        let profileMap={};
        if(candidateIds.length){
            const {data:profiles,error:profileError}=await client
                .from('profiles')
                .select('id,full_name,inter_rivalry_id')
                .in('id',candidateIds);
            if(profileError) console.warn('CR candidate profile load:',profileError.message);
            (profiles||[]).forEach(p=>{profileMap[p.id]=p;});
        }
        currentCrCandidates=(candidateRows||[]).map(c=>({
            ...c,
            profiles:profileMap[c.user_id]||null
        }));
    }

    const {data:myVote,error:voteError}=await client
        .from('cr_votes')
        .select('id')
        .eq('election_id',election.id)
        .eq('voter_id',ctx.user.id)
        .maybeSingle();

    if(voteError){
        console.error('CR vote lookup error:',voteError);
    }

    const end=election.ends_at?new Date(election.ends_at):null;
    const open=election.status==='open' && (!end || end>new Date());

    if(status)status.textContent=open?'Voting is open':'Voting is closed';
    if(summary)summary.textContent=`${currentCrCandidates.length} approved candidate(s) • ${myVote?'Your vote has been recorded':'You have not voted yet'}`;
}

async function openCrElectionModal(){
    const modal=document.getElementById('crElectionModal'); const content=document.getElementById('crElectionModalContent'); const st=document.getElementById('crElectionModalStatus');
    modal.style.display='flex'; content.innerHTML='<div class="empty-box">Loading election...</div>';
    const ctx=await getCrElectionContext(); if(!ctx){content.innerHTML='<div class="empty-box">Join and get approved by your college first.</div>';return;}
    await loadCrElection();
    if(!currentCrElection){st.textContent='No active election';content.innerHTML='<div class="empty-box">No election has been opened for your class yet.</div>';return;}
    const m=ctx.membership, user=ctx.user, e=currentCrElection;
    const open=e.status==='open' && (!e.ends_at || new Date(e.ends_at)>new Date());
    const {data:myPreference}=await client.from('cr_candidate_preferences').select('willing').eq('election_id',e.id).eq('user_id',user.id).maybeSingle();
    const {data:myNomination}=await client.from('cr_nominations').select('id,status').eq('election_id',e.id).eq('user_id',user.id).maybeSingle();
    const {data:myVote}=await client.from('cr_votes').select('candidate_id').eq('election_id',e.id).eq('voter_id',user.id).maybeSingle();
    st.textContent=`${e.status.toUpperCase()} • ${e.ends_at?'Closes '+new Date(e.ends_at).toLocaleString():'No closing time set'}`;
    let html='';
    html+=`<div style="padding:14px;border:1px solid #303030;border-radius:14px;background:#101010;margin-bottom:14px;"><div style="color:white;font-weight:800;">Candidate preference</div><div style="font-size:12px;color:#888;margin:6px 0 12px;">Choose whether you are willing to become CR. If you opt out, your name cannot be nominated.</div><div style="display:flex;gap:8px;flex-wrap:wrap;"><button class="btn-3d-sm-white-glow" onclick="setCrWilling(true)">✅ I WISH TO BECOME CR</button><button class="btn-3d-sm-white-glow-danger" onclick="setCrWilling(false)">🚫 I'M NOT WISHING TO BECOME CR</button></div><div style="color:#777;font-size:12px;margin-top:8px;">Current choice: <strong style="color:white;">${myPreference? (myPreference.willing?'Willing':'Not willing') : 'Not selected'}</strong></div></div>`;
    html+=`<div style="color:white;font-weight:900;font-size:16px;margin:14px 0 10px;">Approved candidates</div>`;
    if(!currentCrCandidates.length) html+='<div class="empty-box">No approved candidates yet.</div>';
    currentCrCandidates.forEach(c=>{
        const name=c.profiles?.full_name||'Student';
        const selected=myVote?.candidate_id===c.user_id;
        const isMe=c.user_id===user.id;
        let voteControl='';
        if(selected){
            voteControl='<span style="color:#00b894;font-size:12px;font-weight:800;">YOUR VOTE</span>';
        }else if(open && !myVote && !isMe){
            voteControl=`<button class="btn-3d-sm-white-glow" onclick="castCrVote('${c.user_id}')" style="width:auto;padding:9px 13px;">VOTE</button>`;
        }else if(open && !myVote && isMe){
            voteControl='<span style="color:#777;font-size:12px;">You cannot vote for yourself</span>';
        }
        html+=`<div style="padding:14px;border:1px solid ${selected?'#00b894':'#2d2d2d'};border-radius:14px;background:#101010;margin-bottom:9px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <div style="flex:1;min-width:160px;">
                <div style="font-weight:800;color:white;">${escapeHTML(name)}</div>
                <div style="font-size:11px;color:#777;">${escapeHTML(c.profiles?.inter_rivalry_id||'')}</div>
                ${c.statement?`<div style="font-size:12px;color:#aaa;margin-top:5px;">${escapeHTML(c.statement)}</div>`:''}
            </div>
            ${voteControl}
        </div>`;
    });
    if(myNomination) html+=`<div style="font-size:12px;color:#888;margin-top:12px;">Your nomination status: <strong style="color:white;">${escapeHTML(myNomination.status)}</strong></div>`;
    if(open && !myNomination && myPreference?.willing) html+=`<button class="btn-3d-white-glow" onclick="nominateForCr()" style="margin-top:14px;">➕ NOMINATE MYSELF</button>`;
    content.innerHTML=html;
}

async function setCrWilling(willing){
    const ctx=await getCrElectionContext(); if(!ctx||!currentCrElection)return;
    const {error}=await client.from('cr_candidate_preferences').upsert({election_id:currentCrElection.id,user_id:ctx.user.id,willing},{onConflict:'election_id,user_id'});
    if(error)return alert('❌ '+error.message);
    await openCrElectionModal();
}
async function nominateForCr(){
    const ctx=await getCrElectionContext(); if(!ctx||!currentCrElection)return;
    const {data:p}=await client.from('cr_candidate_preferences').select('willing').eq('election_id',currentCrElection.id).eq('user_id',ctx.user.id).maybeSingle();
    if(!p?.willing)return alert('Choose “I WISH TO BECOME CR” first.');
    const statement=prompt('Optional short introduction (leave blank if you want):',''); if(statement===null)return;
    const {error}=await client.from('cr_nominations').insert({election_id:currentCrElection.id,user_id:ctx.user.id,statement:statement.trim(),status:'approved'});
    if(error)return alert('❌ '+error.message);
    await openCrElectionModal();
}
async function castCrVote(candidateId){
    const ctx=await getCrElectionContext(); if(!ctx||!currentCrElection)return;
    if(candidateId===ctx.user.id)return alert('You cannot vote for yourself.');
    if(!confirm('Submit your vote? You can vote only once.'))return;
    const {error}=await client.from('cr_votes').insert({election_id:currentCrElection.id,voter_id:ctx.user.id,candidate_id:candidateId});
    if(error)return alert('❌ '+error.message);
    alert('✅ Your vote has been recorded privately.'); await openCrElectionModal(); await loadCrElection();
}

// ==================== CLASS GRADE BOOK / CR HELPERS ====================
let classSubjectMode = false;
let editingSubjectId = null;
let currentClassMembership = null;

function makeClassKey(membership){
    if(!membership) return '';
    return [membership.college_id, membership.course, membership.year_of_study, membership.specialization || ''].join('::');
}

async function getMyClassMembership(){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return null;
    const { data } = await client.from('college_memberships')
        .select('id,user_id,college_id,course,year_of_study,specialization,is_active,colleges(college_name)')
        .eq('user_id', user.id).eq('is_active', true).maybeSingle();
    return data || null;
}

async function getMyClassRepresentative(){
    const membership = currentClassMembership || await getMyClassMembership();
    if(!membership) return { membership:null, representative:null, isCR:false };
    const { data: { user } } = await client.auth.getUser();
    if(!user) return { membership, representative:null, isCR:false };
    const { data: rep } = await client.from('class_representatives')
        .select('id,user_id,course,year_of_study,specialization,college_id,is_active')
        .eq('college_id', membership.college_id)
        .eq('course', membership.course)
        .eq('year_of_study', membership.year_of_study)
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
    return { membership, representative:rep || null, isCR:!!rep };
}

async function loadClassRepresentativeCard(){
    const card = document.getElementById('myClassCrCard');
    const nameEl = document.getElementById('myClassCrName');
    if(!card) return;
    const membership = currentClassMembership || await getMyClassMembership();
    currentClassMembership = membership;
    if(!membership){ card.style.display='none'; return; }
    const { data: rep } = await client.from('class_representatives')
        .select('user_id')
        .eq('college_id', membership.college_id)
        .eq('course', membership.course)
        .eq('year_of_study', membership.year_of_study)
        .eq('is_active', true)
        .maybeSingle();
    if(rep){
        card.style.display='block';
        if(nameEl) nameEl.textContent = rep.user_id === membership.user_id ? 'You are the current Class Representative' : 'Class Representative';
    } else {
        card.style.display='none';
    }
}

async function refreshGradeBookCrControls(){
    const controls=document.getElementById('gradeBookCrControls');
    if(!controls) return false;
    const state=await getMyClassRepresentative();
    currentClassMembership=state.membership;
    controls.style.display=state.isCR?'block':'none';
    return state.isCR;
}

// ==================== GRADE BOOK FUNCTIONS ====================
async function loadGradeBook(semester) {
    const content=document.getElementById('gradeBookContent'); content.innerHTML="<div class='empty-box'>Loading your grades...</div>";
    const {data:{user}}=await client.auth.getUser(); if(!user)return;
    const membership=currentClassMembership||await getMyClassMembership(); if(!membership){content.innerHTML="<div class='empty-box'>You need to join a college first.</div>";return;}
    currentClassMembership=membership; await refreshGradeBookCrControls();
    const {data:globalSubjects,error:globalError}=await client.from('subjects').select('*').eq('course',membership.course).eq('semester',semester).order('subject_name');
    if(globalError){content.innerHTML=`<div class='empty-box'>Error: ${escapeHTML(globalError.message)}</div>`;return;}
    const {data:classSubjects,error:classError}=await client.from('class_subjects').select('*').eq('college_id',membership.college_id).eq('course',membership.course).eq('year_of_study',membership.year_of_study).eq('semester',semester).eq('is_active',true).order('subject_name');
    if(classError){content.innerHTML=`<div class='empty-box'>Error loading class subjects: ${escapeHTML(classError.message)}</div>`;return;}
    const subjects=[...(globalSubjects||[]).filter(x=>!x.is_class_subject||!x.class_key||x.class_key===makeClassKey(membership)),...(classSubjects||[]).map(x=>({...x,is_class_subject:true}))];
    const {data:grades}=await client.from('grades').select('*').eq('user_id',user.id).eq('semester',semester);
    const {data:classMarks}=await client.from('class_subject_marks').select('*').eq('user_id',user.id);
    const gradeMap={}; (grades||[]).forEach(x=>gradeMap[x.subject_id]={marks:x.marks_obtained}); (classMarks||[]).forEach(x=>gradeMap[x.subject_id]={marks:x.marks});
    const {data:profile}=await client.from('profiles').select('role').eq('id',user.id).single();
    const globalAdmin=profile?.role==='super_admin'||profile?.role==='college_admin'; const crState=await getMyClassRepresentative();
    if(!subjects.length){content.innerHTML=`<div class='empty-box'><h2>No Subjects Found</h2>${crState.isCR?`<button class="btn-3d-white-glow" onclick="openAddSubject(true)">➕ ADD SUBJECT</button>`:''}</div>`;return;}
    let total=0,maxTotal=0,count=0,html=`<div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:23px;margin-bottom:20px;"><h2 style="color:white;margin-bottom:15px;">📚 ${escapeHTML(membership.course)} - Semester ${semester}</h2><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:15px;">`;
    subjects.forEach(subject=>{const rec=gradeMap[subject.id],marks=rec?.marks??null,max=Number(subject.max_marks||100),pct=marks!==null?Math.round(Number(marks)/max*100):null,letter=marks!==null?getGrade(pct):null,gpa=marks!==null?getGPA(pct):null; if(marks!==null){total+=Number(marks);maxTotal+=max;count++;} const canManage=globalAdmin||(crState.isCR&&subject.is_class_subject); html+=`<div class="grade-card ${letter?getGradeClass(letter):''}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;"><div><h4 style="color:white;">📘 ${escapeHTML(subject.subject_name)}</h4>${subject.is_class_subject?'<span style="font-size:10px;color:#fdcb6e;">CLASS SUBJECT</span>':''}</div>${canManage?`<div><button class="btn-3d-xs-white-glow" onclick="openEditSubject('${subject.id}',${!!subject.is_class_subject})">✏️</button><button class="btn-3d-xs-white-glow" onclick="deleteSubject('${subject.id}','${escapeHTML(subject.subject_name)}',${semester},${!!subject.is_class_subject})">🗑️</button></div>`:''}${marks!==null?`<span style="color:#00b894;font-weight:800;">${pct}% • ${letter}</span>`:`<button class="btn-3d-xs-white-glow" onclick="openAddMarks('${subject.id}','${escapeHTML(subject.subject_name)}',${semester},${!!subject.is_class_subject})">➕ ADD MARKS</button>`}</div>${marks!==null?`<div style="margin-top:10px;color:#aaa;">Score: <strong style="color:white;">${marks}/${max}</strong> • GPA: <strong style="color:#00d2ff;">${gpa.toFixed(1)}</strong><button class="btn-3d-xs-white-glow" onclick="openAddMarks('${subject.id}','${escapeHTML(subject.subject_name)}',${semester},${!!subject.is_class_subject})" style="margin-left:10px;">✏️ EDIT</button></div>`:'<div style="margin-top:8px;color:#666;font-size:12px;">⏳ Marks not entered yet</div>'}</div>`;});
    const avg=count?Math.round(total/maxTotal*100):0,gpa=count?getGPA(avg):0; html+=`</div></div><div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:23px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;text-align:center;"><div><small>Semester GPA</small><div class="gpa-circle ${getGpaClass(gpa)}">${gpa.toFixed(1)}</div></div><div><small>Subjects</small><div style="font-size:30px;color:white;">${count}/${subjects.length}</div></div><div><small>Average</small><div style="font-size:30px;color:white;">${avg}%</div></div><div><small>Grade</small><div style="font-size:30px;color:#00b894;">${count?getGrade(avg):'N/A'}</div></div></div>`; content.innerHTML=html;
}

// ==================== ADD MARKS MODAL ====================
async function openAddMarks(subjectId,subjectName,semester,isClassSubject=false){
    const table=isClassSubject?'class_subjects':'subjects',markTable=isClassSubject?'class_subject_marks':'grades',markColumn=isClassSubject?'marks':'marks_obtained';
    const {data:subject}=await client.from(table).select('max_marks').eq('id',subjectId).maybeSingle(); const {data:{user}}=await client.auth.getUser();
    const {data:existing}=user?await client.from(markTable).select(markColumn).eq('user_id',user.id).eq('subject_id',subjectId).maybeSingle():{data:null}; const max=Number(subject?.max_marks||100);
    const overlay=document.createElement('div');overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:20px;';
    const modal=document.createElement('div');modal.style.cssText='background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:30px;max-width:450px;width:100%;';modal.innerHTML=`<h2 style="color:white;text-align:center;">📝 Enter Marks</h2><p style="color:#aaa;text-align:center;">${escapeHTML(subjectName)}</p><input id="marksInput" type="number" value="${existing?.[markColumn]??''}" min="0" max="${max}" step=".01" style="width:100%;padding:14px;background:#0a0a0a;color:white;border:1px solid #333;border-radius:10px;"><p style="color:#777;font-size:12px;">Out of ${max}</p><div id="marksMessage"></div><button id="saveMarksBtn" class="btn-3d-white-glow" onclick="saveMarks('${subjectId}',${semester},${max},${isClassSubject})">💾 SAVE</button> <button class="btn-3d-sm-white-glow-danger" onclick="this.closest('div[style]').parentElement.remove()">CANCEL</button>`;overlay.appendChild(modal);document.body.appendChild(overlay);overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
}
async function saveMarks(subjectId,semester,maxMarks,isClassSubject=false){const input=document.getElementById('marksInput'),msg=document.getElementById('marksMessage'),btn=document.getElementById('saveMarksBtn'),marks=Number(input.value);if(!Number.isFinite(marks)||marks<0||marks>Number(maxMarks)){msg.textContent='⚠️ Enter valid marks.';msg.style.color='#ff6b6b';return;}const {data:{user}}=await client.auth.getUser();if(!user)return;let error;if(isClassSubject){({error}=await client.from('class_subject_marks').upsert({subject_id:subjectId,user_id:user.id,marks,updated_at:new Date().toISOString()},{onConflict:'subject_id,user_id'}));}else{const {data:old}=await client.from('grades').select('id').eq('user_id',user.id).eq('subject_id',subjectId).maybeSingle();if(old)({error}=await client.from('grades').update({marks_obtained:marks,updated_at:new Date().toISOString()}).eq('id',old.id));else({error}=await client.from('grades').insert({user_id:user.id,subject_id:subjectId,marks_obtained:marks,semester,academic_year:new Date().getFullYear()+'-'+(new Date().getFullYear()+1)}));}if(error){msg.textContent='❌ '+error.message;msg.style.color='#ff6b6b';return;}msg.textContent='✅ Saved';msg.style.color='#00b894';setTimeout(()=>{document.querySelector('div[style*="position:fixed"][style*="z-index:9999"]')?.remove();loadGradeBook(semester);},500);}

// ==================== GRADE LEADERBOARD ====================
async function loadGradeLeaderboard(semester) {
    const content = document.getElementById('gradeLeaderboardContent');
    content.innerHTML = "<div class='empty-box'>Loading your class rankings...</div>";
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;

    const { data: leaderboard, error } = await client.rpc('get_my_class_grade_leaderboard', {
        p_semester: Number(semester) || 0
    });

    if (error) {
        content.innerHTML = `<div class='empty-box'>Error loading class rankings: ${escapeHTML(error.message)}</div>`;
        return;
    }

    const rows = leaderboard || [];
    if (rows.length === 0) {
        content.innerHTML = `<div class='empty-box'>No grades found for ${semester > 0 ? semester + (semester === 1 ? 'st' : semester === 2 ? 'nd' : semester === 3 ? 'rd' : 'th') + ' Semester' : 'Overall'} in your class yet.</div>`;
        return;
    }

    const userRow = rows.find(r => r.user_id === user.id);
    const userRank = userRow?.class_rank || '-';
    const totalStudents = rows.length;

    let html = `
        <div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:23px;margin-bottom:20px;">
            <h2 style="color:#111;margin-bottom:15px;">🏆 ${escapeHTML(rows[0].course || 'Class')} - ${semester > 0 ? semester + (semester === 1 ? 'st' : semester === 2 ? 'nd' : semester === 3 ? 'rd' : 'th') + ' Semester' : 'Overall'} Class Toppers</h2>
            <div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:15px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <div><span style="color:#888;">Your Rank:</span> <span style="font-size:24px;font-weight:900;color:#111;">#${userRank}</span> <span style="color:#888;font-size:14px;">out of ${totalStudents} students with grades</span></div>
                <div><span style="color:#888;">GPA:</span> <span style="font-size:24px;font-weight:900;color:#00d2ff;">${userRow ? Number(userRow.gpa).toFixed(1) : 'N/A'}</span></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
    `;

    rows.forEach(student => {
        const rank = Number(student.class_rank);
        const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
        const isCurrentUser = student.user_id === user.id;
        html += `
            <div style="display:flex;align-items:center;padding:12px 16px;background:${isCurrentUser ? '#1a1a2e' : '#0a0a0a'};border:2px solid ${isCurrentUser ? '#fdcb6e' : '#282828'};border-radius:12px;gap:12px;flex-wrap:wrap;">
                <div style="font-size:24px;min-width:45px;text-align:center;">${medal}</div>
                <div style="flex:1;min-width:120px;">
                    <div style="font-weight:700;font-size:16px;">${isCurrentUser ? '⭐ ' : ''}${escapeHTML(student.full_name || 'Unknown')}${isCurrentUser ? ' <span style="font-size:12px;color:#111;">(YOU)</span>' : ''}</div>
                    <div style="font-size:12px;color:#666;">${escapeHTML(student.inter_rivalry_id || '-')}</div>
                </div>
                <div style="display:flex;align-items:center;gap:15px;flex-wrap:wrap;">
                    <div style="text-align:center;"><div style="font-size:18px;font-weight:900;color:#00d2ff;">${Number(student.gpa).toFixed(1)}</div><div style="font-size:10px;color:#888;">GPA</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#111;">${student.avg_percentage}%</div><div style="font-size:10px;color:#888;">Avg</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#00b894;">${escapeHTML(student.grade || '-')}</div><div style="font-size:10px;color:#888;">Grade</div></div>
                    <div style="text-align:center;"><div style="font-size:14px;font-weight:600;color:#888;">${student.subject_count}</div><div style="font-size:10px;color:#888;">Subjects</div></div>
                </div>
            </div>`;
    });

    html += `</div></div>
        <div style="margin-top:15px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
            <button class="btn-3d-sm-white-glow" onclick="loadGradeLeaderboard(${Number(semester) || 0})" style="width:auto;padding:8px 20px;">🔄 REFRESH</button>
        </div>`;
    content.innerHTML = html;

    document.querySelectorAll('#gradeLeaderboardPage .filter-btn').forEach(btn => { btn.style.opacity='0.5'; btn.style.transform='scale(0.95)'; });
    const activeBtn = document.getElementById(semester > 0 ? `lbSem${semester}` : 'lbOverall');
    if (activeBtn) { activeBtn.style.opacity='1'; activeBtn.style.transform='scale(1)'; }
}

// ==================== MY CLASS ====================
async function loadMyClass(){
    const info = document.getElementById('myClassInfo');
    const list = document.getElementById('myClassmatesList');
    if(info) info.innerHTML = "<div class='empty-box'>Loading your class...</div>";
    if(list) list.innerHTML = "<div class='empty-box'>Loading classmates...</div>";

    const { data: { user } } = await client.auth.getUser();
    if(!user){
        if(info) info.innerHTML = "<div class='empty-box'>Please login first.</div>";
        return;
    }

    // Do not depend on the old get_my_cls RPC. Build the class from the
    // student's active college membership and fetch classmates directly.
    const { data: me, error: meError } = await client
        .from('college_memberships')
        .select('id,user_id,college_id,course,year_of_study,specialization,is_active,colleges(college_name)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

    if(meError){
        console.error('My Class membership error:', meError);
        if(info) info.innerHTML = `<div class='empty-box'>Error loading your class: ${escapeHTML(meError.message)}</div>`;
        if(list) list.innerHTML = '';
        return;
    }

    if(!me){
        if(info) info.innerHTML = "<div class='empty-box'>Join and get approved by your college before viewing your class.</div>";
        if(list) list.innerHTML = '';
        return;
    }

    currentClassMembership = me;

    const norm = v => String(v ?? '').trim().toLowerCase();
    const sameClass = row =>
        String(row.college_id) === String(me.college_id) &&
        norm(row.course) === norm(me.course) &&
        Number(row.year_of_study) === Number(me.year_of_study) &&
        norm(row.specialization) === norm(me.specialization);

    // Fetch active memberships for the college first, then normalize the
    // text fields in JavaScript so values such as "AI ML" / "AI & ML"
    // don't silently break the My Class page.
    const { data: memberships, error: membersError } = await client
        .from('college_memberships')
        .select('id,user_id,college_id,course,year_of_study,specialization,is_active')
        .eq('college_id', me.college_id)
        .eq('is_active', true);

    if(membersError){
        console.error('My Class classmates error:', membersError);
        if(info) info.innerHTML = `<div class='empty-box'>Error loading classmates: ${escapeHTML(membersError.message)}</div>`;
        if(list) list.innerHTML = '';
        return;
    }

    const classMemberships = (memberships || []).filter(sameClass);
    const ids = [...new Set(classMemberships.map(x => x.user_id).filter(Boolean))];

    let profiles = [];
    if(ids.length){
        const { data: profileRows, error: profileError } = await client
            .from('profiles')
            .select('id,full_name,inter_rivalry_id,chess_com_username')
            .in('id', ids);
        if(profileError) console.error('My Class profiles error:', profileError);
        profiles = profileRows || [];
    }

    const profileMap = new Map(profiles.map(p => [p.id, p]));
    const students = classMemberships.map(m => ({
        ...m,
        ...(profileMap.get(m.user_id) || {})
    }));

    const yearNumber = Number(me.year_of_study);
    const yearLabel = yearNumber === 1 ? '1st Year' : yearNumber === 2 ? '2nd Year' : yearNumber === 3 ? '3rd Year' : `${yearNumber}th Year`;
    const classLabel = me.course === 'BCA'
        ? `BCA • ${yearLabel} • ${escapeHTML(me.specialization || 'General')}`
        : `${escapeHTML(me.course || 'Course')} • ${yearLabel}`;

    if(info){
        info.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;gap:15px;flex-wrap:wrap;">
                <div>
                    <div style="font-size:12px;color:#888;">YOUR CLASS</div>
                    <div style="font-size:22px;font-weight:900;color:white;margin-top:5px;">${classLabel}</div>
                    <div style="font-size:13px;color:#666;margin-top:6px;">🏛️ ${escapeHTML(me.colleges?.college_name || 'College')}</div>
                </div>
                <div style="text-align:center;">
                    <div style="font-size:30px;font-weight:900;color:#00d2ff;">${students.length}</div>
                    <div style="font-size:11px;color:#888;">CLASSMATES</div>
                </div>
            </div>`;
    }

    if(list){
        let html = '';
        students.forEach(student => {
            const isMe = student.user_id === user.id;
            html += `
            <div style="background:${isMe ? '#15152a' : '#0e0e0e'};border:1px solid ${isMe ? '#fdcb6e' : '#282828'};border-radius:14px;padding:16px;margin-bottom:10px;">
                <div style="display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap;">
                    <div style="font-size:32px;">${isMe ? '⭐' : '👤'}</div>
                    <div style="flex:1;min-width:180px;">
                        <div style="font-size:17px;font-weight:800;color:white;">${escapeHTML(student.full_name || 'Student')}${isMe ? ' <span style="font-size:11px;color:#fdcb6e;">YOU</span>' : ''}</div>
                        <div style="font-size:12px;color:#666;margin-top:3px;">${escapeHTML(student.inter_rivalry_id || 'IR-Not assigned')}</div>
                        ${student.chess_com_username ? `<div style="font-size:12px;color:#888;margin-top:6px;">♟️ Chess.com: ${escapeHTML(student.chess_com_username)}</div>` : ''}
                    </div>
                </div>
            </div>`;
        });
        list.innerHTML = html || "<div class='empty-box'>No classmates found.</div>";
    }

    await loadCrElection();
}

// ==================== ADMIN FUNCTIONS ====================
function openAddSubject(forClass = false) {
    classSubjectMode = !!forClass;
    editingSubjectId = null;
    document.getElementById('addSubjectModal').style.display = 'flex';
    document.querySelector('#addSubjectModal h2').textContent = classSubjectMode ? '📚 Add Class Subject' : '📚 Add Subject';
    document.getElementById('subjectMessage').textContent = '';
    document.getElementById('subjectName').value = '';
    document.getElementById('subjectCode').value = '';
    document.getElementById('subjectMaxMarks').value = '100';
    const saveBtn = document.querySelector('#addSubjectModal button[onclick="saveSubject()"]');
    if(saveBtn) saveBtn.textContent = '✅ ADD SUBJECT';
    const courseSelect = document.getElementById('subjectCourse');
    const state = currentClassMembership;
    if(classSubjectMode && state){
        courseSelect.value = state.course || 'BCA';
        courseSelect.disabled = true;
        const sem = document.getElementById('subjectSemester');
        sem.value = '1';
    } else {
        courseSelect.disabled = false;
    }
}

async function openEditSubject(subjectId,isClassSubject=false){const table=isClassSubject?'class_subjects':'subjects';const {data:subject,error}=await client.from(table).select('*').eq('id',subjectId).maybeSingle();if(error||!subject)return alert('Subject not found.');classSubjectMode=isClassSubject;editingSubjectId=subjectId;document.getElementById('addSubjectModal').style.display='flex';document.querySelector('#addSubjectModal h2').textContent=isClassSubject?'✏️ Edit Class Subject':'✏️ Edit Subject';document.getElementById('subjectCourse').value=subject.course||'BCA';document.getElementById('subjectCourse').disabled=isClassSubject;document.getElementById('subjectSemester').value=String(subject.semester||1);document.getElementById('subjectName').value=subject.subject_name||'';document.getElementById('subjectCode').value=subject.subject_code||'';document.getElementById('subjectMaxMarks').value=subject.max_marks||100;document.getElementById('subjectMessage').textContent='';}
async function deleteSubject(subjectId,subjectName,semester,isClassSubject=false){if(!confirm(`Delete "${subjectName}"?`))return;const {error}=await client.from(isClassSubject?'class_subjects':'subjects').delete().eq('id',subjectId);if(error)return alert('❌ '+error.message);loadGradeBook(semester);}
async function saveSubject(){const course=document.getElementById('subjectCourse').value,semester=Number(document.getElementById('subjectSemester').value),name=document.getElementById('subjectName').value.trim(),code=document.getElementById('subjectCode').value.trim(),maxMarks=Number(document.getElementById('subjectMaxMarks').value)||100,msg=document.getElementById('subjectMessage');if(!name||maxMarks<=0||maxMarks>1000){msg.textContent='⚠️ Enter valid subject details.';return;}const {data:{user}}=await client.auth.getUser();if(!user)return;const membership=currentClassMembership||await getMyClassMembership(),cr=await getMyClassRepresentative(),isAdmin=currentUserRole==='super_admin'||currentUserRole==='college_admin';if(classSubjectMode&&!cr.isCR){msg.textContent='⚠️ Only the CR can manage class subjects.';return;}if(!classSubjectMode&&!isAdmin){msg.textContent='⚠️ Only admins can manage global subjects.';return;}const table=classSubjectMode?'class_subjects':'subjects';let payload;if(classSubjectMode)payload={college_id:membership.college_id,course:membership.course,year_of_study:membership.year_of_study,specialization:membership.specialization||null,subject_name:name,max_marks:maxMarks,semester,is_active:true,created_by:user.id};else{let collegeId=null;if(currentUserRole==='super_admin'){const {data:c}=await client.from('colleges').select('id').limit(1);collegeId=c?.[0]?.id;}else{const {data:a}=await client.from('college_admins').select('college_id').eq('user_id',user.id).maybeSingle();collegeId=a?.college_id;}if(!collegeId){msg.textContent='⚠️ No college assigned.';return;}payload={college_id:collegeId,course,semester,subject_name:name,subject_code:code||null,max_marks:maxMarks,is_class_subject:false,class_key:null,specialization:null,created_by:user.id};}const result=editingSubjectId?await client.from(table).update(payload).eq('id',editingSubjectId):await client.from(table).insert(payload);if(result.error){msg.textContent='❌ '+result.error.message;return;}msg.textContent='✅ Saved';setTimeout(()=>{closeAddSubject();loadGradeBook(semester);},500);}

// ==================== ADMIN FUNCTIONS: VIEW STUDENTS ====================
async function viewCollegeStudents() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    
    const { data: profile } = await client.from('profiles').select('role').eq('id', user.id).single();
    const isAdmin = profile?.role === 'super_admin' || profile?.role === 'college_admin';
    
    if (!isAdmin) {
        alert('⚠️ Only admins can view students.');
        return;
    }
    
    let collegeId = null;
    let collegeName = 'All Colleges';
    
    if (profile?.role === 'super_admin') {
        const { data: colleges } = await client.from('colleges').select('id, college_name').limit(1);
        if (colleges && colleges.length > 0) {
            collegeId = colleges[0].id;
            collegeName = colleges[0].college_name;
        }
    } else {
        const { data: admin } = await client
            .from('college_admins')
            .select('college_id, colleges(college_name)')
            .eq('user_id', user.id)
            .maybeSingle();
        
        if (admin) {
            collegeId = admin.college_id;
            collegeName = admin.colleges?.college_name || 'Your College';
        }
    }
    
    if (!collegeId) {
        alert('No college found.');
        return;
    }
    
    const { data: students, error } = await client
        .from('college_memberships')
        .select(`
            user_id,
            profiles!college_memberships_user_id_fkey (
                id,
                full_name,
                inter_rivalry_id,
                email,
                role
            ),
            course,
            year_of_study,
            specialization,
            joined_at
        `)
        .eq('college_id', collegeId)
        .eq('is_active', true)
        .order('year_of_study', { ascending: true });
    
    if (error) {
        alert('Error loading students: ' + error.message);
        return;
    }
    
    if (!students || students.length === 0) {
        alert('📚 No students found in ' + collegeName);
        return;
    }
    
    let msg = `🎓 STUDENTS IN ${collegeName.toUpperCase()}:\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    const studentList = [];
    students.forEach((s, i) => {
        const profile = s.profiles;
        const name = profile?.full_name || 'Unknown';
        const id = profile?.inter_rivalry_id || 'N/A';
        const year = s.year_of_study || '?';
        const course = s.course || 'N/A';
        const isAdminUser = profile?.role === 'super_admin' || profile?.role === 'college_admin';
        
        studentList.push({
            index: i + 1,
            userId: s.user_id,
            name: name,
            id: id,
            year: year,
            course: course,
            isAdmin: isAdminUser
        });
        
        msg += `${i+1}. ${name}\n`;
        msg += `   📛 ID: ${id}\n`;
        msg += `   📚 ${course} - ${year}${year === 1 ? 'st' : year === 2 ? 'nd' : year === 3 ? 'rd' : 'th'} Year\n`;
        if (isAdminUser) msg += `   👑 ADMIN\n`;
        msg += `\n`;
    });
    
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📊 Total: ${students.length} students\n\n`;
    msg += `To DELETE a student, type: delete [number]\n`;
    msg += `Example: delete 3\n`;
    msg += `Type "cancel" to exit.`;
    
    const response = prompt(msg);
    if (!response || response.toLowerCase() === 'cancel') return;
    
    if (response.toLowerCase().startsWith('delete')) {
        const num = parseInt(response.split(' ')[1]);
        if (num && num > 0 && num <= studentList.length) {
            const student = studentList[num - 1];
            
            if (student.isAdmin) {
                alert('⚠️ Cannot delete an admin user!');
                return;
            }
            
            if (student.userId === user.id) {
                alert('⚠️ You cannot delete yourself!');
                return;
            }
            
            const confirmDelete = confirm(`⚠️ Are you sure you want to delete ${student.name} (${student.id}) from the system?\n\nThis will permanently remove their account and all data!`);
            
            if (confirmDelete) {
                await deleteStudent(student.userId, student.name);
                viewCollegeStudents();
            }
        } else {
            alert('❌ Invalid number. Please use: delete [number]');
        }
    }
}

// ==================== DELETE STUDENT FUNCTION ====================
async function deleteStudent(userId, studentName) {
    try {
        await client.from('grades').delete().eq('user_id', userId);
        await client.from('college_memberships').delete().eq('user_id', userId);
        await client.from('college_join_requests').delete().eq('student_id', userId);
        await client.from('challenges').delete().or(`challenger_id.eq.${userId},opponent_id.eq.${userId}`);
        await client.from('team_members').delete().eq('user_id', userId);
        await client.from('team_invites').delete().or(`sender_id.eq.${userId},invitee_id.eq.${userId}`);
        await client.from('notifications').delete().eq('user_id', userId);
        await client.from('participations').delete().eq('user_id', userId);
        await client.from('quiz_answers').delete().eq('user_id', userId);
        await client.from('tournament_participants').delete().eq('user_id', userId);
        await client.from('college_admins').delete().eq('user_id', userId);
        await client.from('profiles').delete().eq('id', userId);
        
        alert(`✅ ${studentName} has been permanently deleted from the system.`);
        
    } catch (error) {
        alert('❌ Error deleting student: ' + error.message);
    }
}

// ==================== ADMIN FUNCTIONS: JOIN REQUESTS ====================
async function loadCollegeJoinRequests() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    
    const { data: profile } = await client.from('profiles').select('role').eq('id', user.id).single();
    const isAdmin = profile?.role === 'super_admin' || profile?.role === 'college_admin';
    
    if (!isAdmin) {
        alert('⚠️ Only admins can view join requests.');
        return;
    }
    
    let collegeId = null;
    let collegeName = 'Your College';
    
    if (profile?.role === 'super_admin') {
        const { data: colleges } = await client.from('colleges').select('id, college_name').limit(1);
        if (colleges && colleges.length > 0) {
            collegeId = colleges[0].id;
            collegeName = colleges[0].college_name;
        }
    } else {
        const { data: admin } = await client
            .from('college_admins')
            .select('college_id, colleges(college_name)')
            .eq('user_id', user.id)
            .maybeSingle();
        
        if (admin) {
            collegeId = admin.college_id;
            collegeName = admin.colleges?.college_name || 'Your College';
        }
    }
    
    if (!collegeId) {
        alert('No college found.');
        return;
    }
    
    const { data: requests, error } = await client
        .from('college_join_requests')
        .select(`
            id,
            student_id,
            profiles!college_join_requests_student_id_fkey (
                full_name,
                inter_rivalry_id,
                email
            ),
            course,
            year_of_study,
            specialization,
            created_at
        `)
        .eq('college_id', collegeId)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });
    
    if (error) {
        alert('Error loading requests: ' + error.message);
        return;
    }
    
    if (!requests || requests.length === 0) {
        alert('📩 No pending join requests for ' + collegeName);
        return;
    }
    
    let msg = `📩 PENDING JOIN REQUESTS - ${collegeName.toUpperCase()}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    const requestList = [];
    requests.forEach((r, i) => {
        const profile = r.profiles;
        requestList.push({
            index: i + 1,
            id: r.id,
            studentId: r.student_id,
            name: profile?.full_name || 'Unknown',
            rivalryId: profile?.inter_rivalry_id || 'N/A',
            course: r.course || 'N/A',
            year: r.year_of_study || '?',
            specialization: r.specialization || 'N/A'
        });
        
        msg += `${i+1}. ${profile?.full_name || 'Unknown'}\n`;
        msg += `   📛 ID: ${profile?.inter_rivalry_id || 'N/A'}\n`;
        msg += `   📚 ${r.course || 'N/A'} - ${r.year_of_study || '?'}${r.year_of_study === 1 ? 'st' : r.year_of_study === 2 ? 'nd' : r.year_of_study === 3 ? 'rd' : 'th'} Year\n`;
        if (r.specialization) msg += `   🎯 ${r.specialization}\n`;
        if (r.section) msg += `   🏷️ Section: ${r.section}\n`;
        msg += `   📅 Requested: ${new Date(r.created_at).toLocaleDateString()}\n\n`;
    });
    
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `To APPROVE: Type the number (e.g., 1)\n`;
    msg += `To REJECT: Type reject [number] (e.g., reject 1)\n`;
    msg += `Type "cancel" to exit.`;
    
    const response = prompt(msg);
    if (!response || response.toLowerCase() === 'cancel') return;
    
    if (response.toLowerCase().startsWith('reject')) {
        const num = parseInt(response.split(' ')[1]);
        if (num && num > 0 && num <= requestList.length) {
            const request = requestList[num - 1];
            await client.from('college_join_requests')
                .update({ status: 'rejected' })
                .eq('id', request.id);
            alert(`❌ ${request.name}'s request has been rejected.`);
            loadCollegeJoinRequests();
        } else {
            alert('❌ Invalid number.');
        }
    } else {
        const num = parseInt(response);
        if (num && num > 0 && num <= requestList.length) {
            const request = requestList[num - 1];
            await approveJoinRequest(request.id);
            loadCollegeJoinRequests();
        } else {
            alert('❌ Invalid number.');
        }
    }
}

async function approveJoinRequest(requestId) {
    const { data: request } = await client
        .from('college_join_requests')
        .select('student_id, college_id, course, year_of_study, specialization, section')
        .eq('id', requestId)
        .single();
    
    if (!request) return alert('Request not found');
    
    const { data: college } = await client
        .from('colleges')
        .select('college_code')
        .eq('id', request.college_id)
        .single();
    
    const collegeCode = college?.college_code || 'XXXX';
    const randomNum = String(Math.floor(1000 + Math.random() * 9000));
    const rivalryId = `IR-${collegeCode}-${randomNum}`;
    
    await client.from('college_join_requests')
        .update({ status: 'approved' })
        .eq('id', requestId);
    
    await client.from('college_memberships')
        .insert({
            user_id: request.student_id,
            college_id: request.college_id,
            course: request.course,
            year_of_study: request.year_of_study,
            specialization: request.specialization,
            section: request.section || null,
            is_active: true,
            joined_at: new Date().toISOString()
        });
    
    await client.from('profiles')
        .update({
            inter_rivalry_id: rivalryId
        })
        .eq('id', request.student_id);
    
    alert(`✅ Student approved!\n🎯 INTER RIVALRY ID: ${rivalryId}`);
}

// ==================== TOGGLE RIVALS ====================

function openLocalRivalSearch(){
    const section=document.getElementById('rivalsSectionFull');
    const sub=document.getElementById('rivalsSubSection');
    if(section) section.style.display='block';
    if(sub) sub.style.display='block';
    const input=document.getElementById('rivalSearchInput');
    const list=document.getElementById('rivalsList');
    if(list) list.innerHTML="<div class='empty-box'>Search by name or IR ID to find Local rivals.</div>";
    if(input) input.focus({preventScroll:true});
    section?.scrollIntoView({behavior:'smooth',block:'start'});
}

function toggleRivals(){
    const section = document.getElementById("rivalsSubSection");
    const btn = document.querySelector("[onclick='toggleRivals()']");
    rivalsVisible = !rivalsVisible;
    if(rivalsVisible){
        section.style.display = "block";
        btn.textContent = "❌ CLOSE RIVALS";
        btn.style.background = "linear-gradient(180deg, #e17055, #c0392b)";
        btn.style.boxShadow = "0 8px 0 #78281f, 0 8px 25px rgba(255,80,80,0.15)";
        btn.style.color = "white";
        btn.style.borderColor = "rgba(255,80,80,0.3)";
        const input=document.getElementById('rivalSearchInput');
        if(input) input.value='';
        const list=document.getElementById('rivalsList');
        if(list) list.innerHTML="<div class='empty-box'>Search by name or IR ID to find rivals.</div>";
        const hint=document.getElementById('rivalSearchHint');
        if(hint) hint.textContent='Type at least 2 characters to search. No one is listed until you search.';
        const filters=document.getElementById('rivalCourseFilters'); if(filters) filters.style.display='none';
    } else {
        section.style.display = "none";
        btn.textContent = "⚔️ FIND RIVALS";
        btn.style.background = "linear-gradient(180deg, #fdcb6e, #f39c12)";
        btn.style.boxShadow = "0 8px 0 #b7791f, 0 8px 25px rgba(255,215,0,0.15)";
        btn.style.color = "#2d3436";
        btn.style.borderColor = "rgba(255,215,0,0.3)";
    }
}

// ==================== SEARCHABLE FIND RIVALS ====================
rivalsLoading = false;
rivalsLoaded = false;
allRivalsData = [];

async function searchRivals(){
    const input=document.getElementById('rivalSearchInput');
    const list=document.getElementById('rivalsList');
    const hint=document.getElementById('rivalSearchHint');
    const query=String(input?.value||'').trim();
    if(!list) return;
    if(query.length<2){
        list.innerHTML="<div class='empty-box'>Type at least 2 characters to search for a rival.</div>";
        if(hint) hint.textContent='Enter at least 2 characters from a name or IR ID.';
        return;
    }
    await loadRivalsData(query);
}

async function loadRivalsData(searchQuery=''){
    const list = document.getElementById('rivalsList');
    const hint = document.getElementById('rivalSearchHint');
    if(!list) return;
    const query=String(searchQuery||'').trim();
    if(query.length<2){
        list.innerHTML="<div class='empty-box'>Search by name or IR ID to find rivals.</div>";
        return;
    }
    if(rivalsLoading) return;
    rivalsLoading = true;
    list.innerHTML = "<div class='empty-box'>🔎 Searching INTER RIVALRY…</div>";
    const { data: { user } } = await client.auth.getUser();
    if(!user){ list.innerHTML = "<div class='empty-box'>Please login first.</div>"; rivalsLoading=false; return; }
    try{
        const battlefield = normalizeBattlefield(currentBattlefield || 'local');
        // Local is global: search every registered profile so a Local user can
        // challenge friends from any city/community. College and Gym stay isolated.
        let scope = { ids: [], communityId: null, collegeId: null };
        if(battlefield !== 'local') scope = await getBattlefieldMemberIds(battlefield, user.id);
        const safeQuery=query.replace(/[,%()]/g,' ').trim();
        let profileQuery = client.from('profiles')
            .select('id,full_name,inter_rivalry_id,role')
            .or(`full_name.ilike.%${safeQuery}%,inter_rivalry_id.ilike.%${safeQuery}%`)
            .order('full_name',{ascending:true})
            .limit(20);
        if(battlefield !== 'local'){
            const ids = (scope.ids || []).filter(id => id !== user.id);
            if(!ids.length){ list.innerHTML = `<div class='empty-box'>No other members in your ${escapeHTML(battlefield)} community yet.</div>`; rivalsLoading=false; return; }
            profileQuery = profileQuery.in('id', ids);
        } else {
            profileQuery = profileQuery.neq('id', user.id);
        }
        const { data: profiles, error } = await profileQuery;
        if(error) throw error;
        const matches=profiles||[];
        if(!matches.length){
            allRivalsData=[];
            list.innerHTML=`<div class='empty-box'>No matches for “${escapeHTML(query)}” ${battlefield === 'local' ? 'across INTER RIVALRY' : `in your ${escapeHTML(battlefield)} community`}. Try another name or IR ID.</div>`;
            if(hint) hint.textContent = battlefield === 'local' ? 'No matches found. Local search covers all registered users.' : 'No matches found. Search is limited to your active community.';
            const courseFilters=document.getElementById('rivalCourseFilters'); if(courseFilters) courseFilters.style.display='none';
            rivalsLoaded=true; rivalsLoading=false; return;
        }
        const matchedIds=matches.map(p=>p.id);
        const [membershipsResult, interestsResult] = await Promise.all([
            battlefield === 'college'
                ? client.from('college_memberships').select('user_id,course,year_of_study,specialization,colleges(college_name)').in('user_id',matchedIds).eq('college_id',scope.collegeId).eq('is_active',true)
                : battlefield === 'local'
                    ? client.from('community_memberships').select('user_id,communities(name,location_area)').in('user_id',matchedIds).eq('status','approved').eq('communities.type','local')
                    : client.from('community_memberships').select('user_id,communities(name,location_area)').in('user_id',matchedIds).eq('community_id',scope.communityId).eq('status','approved'),
            client.from('participations').select('user_id,subcategories(name,categories(name))').in('user_id',matchedIds)
        ]);
        const memberships=membershipsResult.data||[];
        const interests=interestsResult.data||[];
        allRivalsData=matches.map(profile=>{
            const membership=memberships.find(m=>m.user_id===profile.id)||{};
            const userInterests=interests.filter(i=>i.user_id===profile.id)||[];
            const tags=[...new Set(userInterests.map(i=>i.subcategories?.categories?.name).filter(Boolean))];
            return {...profile,course:membership?.course||'Member',year:membership?.year_of_study||null,
                college:battlefield==='college'?(membership?.colleges?.college_name||'Unknown'):(membership?.communities?.name||'Unknown'),
                specialization:membership?.specialization||null,interests:tags.slice(0,8)};
        });
        displayRivalsByCategory(battlefield==='college'?'all':'search');
        if(hint) hint.textContent = battlefield === 'local' ? `Showing ${allRivalsData.length} matching rival${allRivalsData.length===1?'':'s'} (maximum 20 per search), across INTER RIVALRY.` : `Showing ${allRivalsData.length} matching rival${allRivalsData.length===1?'':'s'} (maximum 20 per search), from your active ${battlefield} community.`;
        rivalsLoaded=true;
    }catch(err){ list.innerHTML=`<div class='empty-box'>Could not search rivals: ${escapeHTML(err.message)}</div>`; }
    finally{ rivalsLoading=false; }
}

function displayRivalsByCategory(category){
    const list = document.getElementById("rivalsList");
    const data = allRivalsData || [];
    const battlefield = normalizeBattlefield(currentBattlefield || 'local');
    const courseFilters = document.getElementById('rivalCourseFilters');
    if(courseFilters) courseFilters.style.display = battlefield === 'college' ? 'flex' : 'none';
    if(!data.length){ list.innerHTML = "<div class='empty-box'>No rivals found.</div>"; return; }

    // Local and Gym rivals are not academic communities. Never show BCA/BBA/B.Com filters,
    // course groupings, or academic details there. College keeps the existing course view.
    if(battlefield === 'local' || battlefield === 'gym'){
        list.innerHTML = data.map(student => {
            const name = student.full_name || 'Unknown';
            const rivalryId = student.inter_rivalry_id || 'Not assigned';
            const tags = student.interests || [];
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;padding:13px 14px;background:#0a0a0a;border:1px solid #282828;border-radius:10px;margin-bottom:8px;">
                <div><span style="font-weight:700;">👤 ${escapeHTML(name)}</span>
                <br><span style="font-size:11px;color:#666;">ID: ${escapeHTML(rivalryId)}</span>
                ${tags.length ? `<br><span style="font-size:10px;color:#666;">${tags.map(t => `#${escapeHTML(t)}`).join(' ')}</span>` : ''}</div>
                <button class="btn-3d-xs-white-glow" style="width:auto;padding:5px 12px;font-size:10px;" onclick="viewProfile('${student.id}')">VIEW</button>
            </div>`;
        }).join('');
        return;
    }
    
    let filtered = data;
    if(category !== 'all'){ filtered = data.filter(s => s.course === category); }
    if(!filtered.length){ list.innerHTML = `<div class='empty-box'>No students found in ${category} category.</div>`; return; }
    
    const grouped = {};
    filtered.forEach(student => {
        const course = student.course || 'Unknown';
        const year = student.year || 0;
        const yearLabel = year === 1 ? '1st Year' : year === 2 ? '2nd Year' : year === 3 ? '3rd Year' : `${year}th Year`;
        if(!grouped[course]) grouped[course] = {};
        if(!grouped[course][yearLabel]) grouped[course][yearLabel] = [];
        grouped[course][yearLabel].push(student);
    });
    
    let html = '';
    const courseOrder = ['BCA', 'BBA', 'B.COM'];
    const sortedCourses = Object.keys(grouped).sort((a, b) => {
        const indexA = courseOrder.indexOf(a);
        const indexB = courseOrder.indexOf(b);
        if(indexA === -1 && indexB === -1) return a.localeCompare(b);
        if(indexA === -1) return 1;
        if(indexB === -1) return -1;
        return indexA - indexB;
    });
    
    sortedCourses.forEach(course => {
        const years = grouped[course];
        const yearKeys = Object.keys(years).sort((a, b) => { const numA = parseInt(a); const numB = parseInt(b); return numA - numB; });
        let courseColor = '#6c5ce7';
        if(course === 'BCA') courseColor = '#6c5ce7';
        else if(course === 'BBA') courseColor = '#00b894';
        else if(course === 'B.COM') courseColor = '#fdcb6e';
        
        html += `<div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:20px;margin-bottom:16px;">
            <h2 style="color:${courseColor};margin-bottom:15px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">${course === 'BCA' ? '💻' : course === 'BBA' ? '📊' : '💰'}</span>
                ${escapeHTML(course)}
                <span style="font-size:14px;color:#888;font-weight:400;">(${filtered.filter(s => s.course === course).length} students)</span>
            </h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:15px;">`;
        
        yearKeys.forEach(year => {
            const students = years[year];
            html += `<div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="color:#00d2ff;font-size:16px;">📅 ${escapeHTML(year)}</h3>
                    <span style="background:#1a1a1a;padding:4px 12px;border-radius:999px;font-size:12px;color:#888;">${students.length} students</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">`;
            
            students.forEach(student => {
                const name = student.full_name || 'Unknown';
                const rivalryId = student.inter_rivalry_id || 'Not assigned';
                const spec = student.specialization || '';
                const tags = student.interests || [];
                html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0a0a0a;border-radius:8px;border-left:3px solid ${courseColor};">
                    <div><span style="font-weight:600;">👤 ${escapeHTML(name)}</span>
                    <br><span style="font-size:11px;color:#666;">ID: ${escapeHTML(rivalryId)}</span>
                    ${spec ? `<br><span style="font-size:11px;color:#888;">🎯 ${escapeHTML(spec)}</span>` : ''}
                    ${tags.length ? `<br><span style="font-size:10px;color:#555;">${tags.map(t => `#${escapeHTML(t)}`).join(' ')}</span>` : ''}</div>
                    <button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:10px;" onclick="viewProfile('${student.id}')">VIEW</button>
                </div>`;
            });
            html += `</div></div>`;
        });
        html += `</div></div>`;
    });
    list.innerHTML = html;
    
    document.querySelectorAll('#rivalsSubSection .filter-btn').forEach(btn => {
        btn.style.opacity = '0.5'; btn.style.transform = 'scale(0.95)';
    });
    const activeBtn = document.getElementById(`rivalFilter${category === 'all' ? 'All' : category}`);
    if(activeBtn) { activeBtn.style.opacity = '1'; activeBtn.style.transform = 'scale(1)'; }
}

function filterRivals(category){ displayRivalsByCategory(category); }

// ==================== MY PROFILE ====================
async function loadMyProfilePage(){
    const { data: { user } } = await client.auth.getUser();
    if(!user) return;

    const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("id,full_name,inter_rivalry_id,chess_com_username")
        .eq("id", user.id)
        .single();
    if(profileError || !profile){
        alert("Unable to load your profile.");
        return;
    }
    currentUserProfile = { ...(currentUserProfile || {}), ...profile };

    // Purchased cosmetics are read from the authenticated user's own inventory.
    const {data:profileItems,error:profileItemsError}=await client.from('ir_coin_inventory').select('item_code').eq('user_id',user.id);
    const hasGoldFrame=!profileItemsError && (profileItems||[]).some(x=>x.item_code==='profile_frame_gold');
    const ownAvatar=document.querySelector('#myProfilePage .profile-big .profile-avatar');
    if(ownAvatar){
      ownAvatar.classList.toggle('ir-gold-frame-equipped',hasGoldFrame);
      ownAvatar.innerHTML=hasGoldFrame ? '<span style="font-size:30px;position:relative;z-index:1;filter:drop-shadow(0 2px 5px #000)">👤</span>' : '👤';
      let label=document.getElementById('irEquippedFrameLabel');
      if(hasGoldFrame){ if(!label){label=document.createElement('div');label.id='irEquippedFrameLabel';label.className='ir-equipped-label';ownAvatar.parentElement.insertBefore(label,ownAvatar.nextSibling);} label.textContent='✦ GOLDEN PROFILE FRAME EQUIPPED'; }
      else if(label) label.remove();
    }
    document.getElementById("myProfileName").textContent = profile.full_name || "Student";
    document.getElementById("myProfileRivalry").textContent = profile.inter_rivalry_id || "IR-XXXX-XXXX";
    document.getElementById("myProfileId").textContent = profile.inter_rivalry_id || "Not assigned";
    document.getElementById("myProfileChess").textContent = profile.chess_com_username || "Not added";
    document.getElementById("editProfileName").value = profile.full_name || "";
    document.getElementById("editProfileRivalry").value = profile.inter_rivalry_id || "";
    document.getElementById("editProfileChess").value = profile.chess_com_username || "";

    const { data: membership } = await client
        .from("college_memberships")
        .select("course,year_of_study,department,specialization,colleges(college_name,college_code)")
        .eq("user_id", user.id)
        .eq("is_active", true)
        .limit(1);
    const m = membership?.[0];
    document.getElementById("myProfileCollege").textContent = m?.colleges
        ? `${m.colleges.college_name} (${m.colleges.college_code})`
        : "College not joined";

    const { data: parts } = await client
        .from("participations")
        .select("subcategory_id,subcategories(name,categories(name))")
        .eq("user_id", user.id)
        .eq("is_active", true);
    const rows = parts || [];
    document.getElementById("myProfileInterests").innerHTML = rows.length
        ? rows.map(x => `<span class="category-tag">${escapeHTML(x.subcategories?.categories?.name || "Skill")} • ${escapeHTML(x.subcategories?.name || "")}</span>`).join("")
        : "<span style='color:#777'>No interests selected.</span>";

    if(document.getElementById("editProfileBox").style.display !== "none"){
        await loadEditProfileInterests(user.id);
    }
}

async function loadEditProfileInterests(userId){
    const box = document.getElementById("editProfileInterests");
    box.innerHTML = "<div class='empty-box'>Loading interests...</div>";
    const [{ data: skills }, { data: parts }] = await Promise.all([
        client.from("subcategories").select("id,name,categories(name)").order("name"),
        client.from("participations").select("subcategory_id").eq("user_id",userId).eq("is_active",true)
    ]);
    if(!skills?.length){ box.innerHTML = "<div class='empty-box'>No skills available.</div>"; return; }
    const selected = new Set((parts||[]).map(x => x.subcategory_id));
    const groups = new Map();
    skills.forEach(s => {
        const cat = s.categories?.name || "Other";
        if(!groups.has(cat)) groups.set(cat, []);
        groups.get(cat).push(s);
    });
    box.innerHTML = [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([cat,items]) =>
        `<div class="interest-category"><h3>${escapeHTML(cat)}</h3><div class="interest-list">${items.map(s =>
            `<label class="interest-item"><input type="checkbox" class="edit-interest-check" value="${escapeHTML(s.id)}" ${selected.has(s.id)?"checked":""}>${escapeHTML(s.name)}</label>`
        ).join("")}</div></div>`
    ).join("");
}

async function toggleEditProfile(force){
    const box = document.getElementById("editProfileBox");
    const shouldOpen = typeof force === "boolean" ? force : box.style.display === "none";
    box.style.display = shouldOpen ? "block" : "none";
    if(shouldOpen){
        const { data: { user } } = await client.auth.getUser();
        if(user) await loadEditProfileInterests(user.id);
        document.getElementById("editProfileMessage").textContent = "";
        document.getElementById("editProfileBtn").textContent = "✖️ CLOSE EDIT";
    } else {
        document.getElementById("editProfileBtn").textContent = "✏️ EDIT PROFILE";
    }
}

async function saveProfileEdits(){
    const message = document.getElementById("editProfileMessage");
    const { data: { user } } = await client.auth.getUser();
    if(!user) return;

    const fullName = document.getElementById("editProfileName").value.trim();
    const chess = document.getElementById("editProfileChess").value.trim();
    const selected = [...document.querySelectorAll(".edit-interest-check:checked")].map(x=>x.value);

    if(!fullName){ message.textContent = "Please enter your full name."; return; }
    if(chess && !/^[A-Za-z0-9_]{3,25}$/.test(chess)){
        message.textContent = "Enter a valid Chess.com username.";
        return;
    }

    message.textContent = "Saving...";
    const { error: profileError } = await client
        .from("profiles")
        .update({ full_name: fullName, chess_com_username: chess || null })
        .eq("id", user.id);
    if(profileError){ message.textContent = "Error: " + profileError.message; return; }

    const { data: currentParts } = await client
        .from("participations")
        .select("id,subcategory_id")
        .eq("user_id",user.id);
    const selectedSet = new Set(selected);
    const current = currentParts || [];

    const deactivateIds = current.filter(x => !selectedSet.has(x.subcategory_id)).map(x=>x.id);
    if(deactivateIds.length){
        const { error } = await client.from("participations").update({ is_active:false }).in("id",deactivateIds);
        if(error){ message.textContent = "Error updating interests: " + error.message; return; }
    }

    const currentMap = new Map(current.map(x=>[x.subcategory_id,x.id]));
    const toInsert = selected.filter(id => !currentMap.has(id)).map(id => ({user_id:user.id,subcategory_id:id,is_active:true}));
    if(toInsert.length){
        const { error } = await client.from("participations").insert(toInsert);
        if(error){ message.textContent = "Error saving interests: " + error.message; return; }
    }

    if(currentUserProfile){
        currentUserProfile.full_name = fullName;
        currentUserProfile.chess_com_username = chess || null;
    }
    document.getElementById("userName").textContent = fullName;
    message.textContent = "✅ Profile updated successfully.";
    await loadMyProfilePage();
    setTimeout(()=>toggleEditProfile(false), 500);
}

// ==================== INTERESTS ====================
async function loadInterestsEditor(){
    const box = document.getElementById("interestEditor");
    box.innerHTML = "<div class='empty-box'>Loading interests...</div>";
    const { data: { user } } = await client.auth.getUser(); if(!user) return;
    const [{ data: skills }, { data: parts }] = await Promise.all([
        client.from("subcategories").select("id,name,categories(name)").order("name"),
        client.from("participations").select("subcategory_id").eq("user_id",user.id)
    ]);
    if(!skills || skills.length === 0){ box.innerHTML = "<div class='empty-box'>No skills available.</div>"; return; }
    interestSkillCache = skills; currentInterestIds = new Set((parts||[]).map(x => x.subcategory_id));
    const groups = new Map();
    skills.forEach(s => { const cat = s.categories?.name || "Other"; if(!groups.has(cat)) groups.set(cat, []); groups.get(cat).push(s); });
    box.innerHTML = [...groups.entries()].sort((a,b) => a[0].localeCompare(b[0])).map(([cat, items]) =>
        `<div class="interest-category"><h3>${escapeHTML(cat)}</h3><div class="interest-list">${items.map(s => `<label class="interest-item"><input type="checkbox" class="interest-check" value="${escapeHTML(s.id)}" ${currentInterestIds.has(s.id) ? "checked" : ""}>${escapeHTML(s.name)}</label>`).join("")}</div></div>`
    ).join("");
}

async function saveInterests(){
    const message = document.getElementById("interestMessage");
    const { data: { user } } = await client.auth.getUser(); if(!user) return;
    const selected = [...document.querySelectorAll(".interest-check:checked")].map(x => x.value);
    message.textContent = "Saving...";
    const keep = new Set(selected);
    const toDelete = [...currentInterestIds].filter(id => !keep.has(id));
    if(toDelete.length){ await client.from("participations").delete().eq("user_id",user.id).in("subcategory_id",toDelete); }
    const toInsert = selected.filter(id => !currentInterestIds.has(id)).map(id => ({ user_id: user.id, subcategory_id: id }));
    if(toInsert.length){ await client.from("participations").insert(toInsert); }
    currentInterestIds = new Set(selected);
    message.textContent = "✅ Interests saved! 🎯";
    await loadMyInterestSummary();
}

async function loadMyInterestSummary(){
    const box = document.getElementById("myInterestSummary");
    if(!box) return;
    const { data: { user } } = await client.auth.getUser(); if(!user) return;
    const { data } = await client.from("participations").select("subcategories(name,categories(name))").eq("user_id",user.id).eq("is_active",true);
    const rows = data || [];
    box.innerHTML = rows.length ? rows.map(x => `<span class="category-tag">${escapeHTML(x.subcategories?.categories?.name || "Skill")} • ${escapeHTML(x.subcategories?.name || "")}</span>`).join("") : "<span style='color:#777'>No interests selected.</span>";
}

async function loadMyQuickStats(){
    const box = document.getElementById("myQuickStats"); if(!box) return;
    const { data: { user } } = await client.auth.getUser(); if(!user) return;
    const { data } = await client.from("challenges").select("status,rules,challenger_id,opponent_id,battlefield_type,community_id").or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`);
    const scope = await getCurrentBattlefieldScope(user.id);
    const rows = (data || []).filter(c => challengeBelongsToBattlefield(c, scope.battlefield, scope.communityId));
    const wins = rows.filter(c => c.status === "completed" && c.rules?.winner_id === user.id).length;
    const completed = rows.filter(c => c.status === "completed").length;
    const pending = rows.filter(c => c.status === "pending").length;
    box.innerHTML = `<div class="stat-grid"><div class="rival-stat"><div class="num">${wins}</div><div class="lbl">Wins</div></div><div class="rival-stat"><div class="num">${completed}</div><div class="lbl">Completed</div></div><div class="rival-stat"><div class="num">${pending}</div><div class="lbl">Pending</div></div></div>`;
}

async function loadResults(){
    const list = document.getElementById("resultsList"), stats = document.getElementById("resultStats");
    list.innerHTML = "<div class='empty-box'>Loading results...</div>";
    const { data: { user } } = await client.auth.getUser(); if(!user) return;
    const { data, error } = await client.from("challenges").select("id,challenger_id,opponent_id,title,starts_at,ends_at,rules,subcategory_id,battlefield_type,community_id,subcategories(name,categories(name))").eq("status","completed").or(`challenger_id.eq.${user.id},opponent_id.eq.${user.id}`).order("ends_at",{ascending:false});
    if(error){ list.innerHTML = `<div class='empty-box'>Could not load results: ${escapeHTML(error.message)}</div>`; return; }
    const scope = await getCurrentBattlefieldScope(user.id);
    const rows = (data || []).filter(c => challengeBelongsToBattlefield(c, scope.battlefield, scope.communityId));
    if(!rows.length){ list.innerHTML = "<div class='empty-box'>No completed results in this profile yet.</div>"; stats.innerHTML = ''; return; }
    const wins = rows.filter(c => c.rules?.team_challenge
        ? (c.rules?.team_winner_member_ids || []).includes(user.id)
        : c.rules?.winner_id === user.id).length;
    const draws = rows.filter(c => c.rules?.result === "draw" && (
        !c.rules?.team_challenge ||
        (c.rules?.team_draw_member_ids || []).includes(user.id)
    )).length;
    const losses = rows.filter(c => c.rules?.team_challenge
        ? (c.rules?.team_loser_member_ids || []).includes(user.id)
        : (c.rules?.winner_id && c.rules?.winner_id !== user.id && c.rules?.result !== "draw")).length;
    stats.innerHTML = `<div class="rival-stat"><div class="num">${wins}</div><div class="lbl">Wins</div></div><div class="rival-stat"><div class="num">${losses}</div><div class="lbl">Losses</div></div><div class="rival-stat"><div class="num">${draws}</div><div class="lbl">Draws</div></div><div class="rival-stat"><div class="num">${rows.length}</div><div class="lbl">Total</div></div>`;
    list.innerHTML = "";
    for(const c of rows){
        const otherId = c.challenger_id === user.id ? c.opponent_id : c.challenger_id;
        const { data: p } = await client.from("profiles").select("full_name,inter_rivalry_id").eq("id",otherId).maybeSingle();
        const winner = c.rules?.team_challenge
            ? (getTeamParticipantResult(c.rules, user.id) || "COMPLETED")
            : (c.rules?.result === "draw" ? "DRAW" : c.rules?.winner_id === user.id ? "WIN 🎉" : "LOSS 😔");
        const skill = c.subcategories ? ((c.subcategories.categories?.name ? c.subcategories.categories.name + " • " : "") + c.subcategories.name) : "Skill";
        const card = document.createElement("div"); card.className = "challenge-card";
        card.innerHTML = `<h3>🏆 ${escapeHTML(c.title)}</h3><div class="challenge-info"><strong>Opponent:</strong> ${escapeHTML(p?.full_name || "User")}<br><strong>ID:</strong> ${escapeHTML(p?.inter_rivalry_id || "-")}<br><strong>Skill:</strong> ${escapeHTML(skill)}<br><strong>Result:</strong> ${escapeHTML(winner)}<br><strong>Score:</strong> ${escapeHTML(c.rules?.player1_score ?? c.rules?.my_score ?? "-")} - ${escapeHTML(c.rules?.player2_score ?? c.rules?.opponent_score ?? "-")}<br><strong>Completed:</strong> ${formatDate(c.ends_at)}</div>`;
        list.appendChild(card);
    }
}

// Local rankings can be viewed by state or by a selected city/area.
let localRankingMode = 'state';
function setLocalRankingMode(mode){
  localRankingMode = mode === 'area' ? 'area' : 'state';
  document.getElementById('localRankStateWrap')?.classList.toggle('hidden', localRankingMode !== 'state');
  document.getElementById('localRankAreaWrap')?.classList.toggle('hidden', localRankingMode !== 'area');
  const a=document.getElementById('localRankStateBtn'), b=document.getElementById('localRankAreaBtn');
  if(a) a.style.opacity=localRankingMode==='state'?'1':'.55'; if(b) b.style.opacity=localRankingMode==='area'?'1':'.55';
  loadLeaderboard('overall');
}
async function initLocalRankingControls(){
  const stateSel=document.getElementById('localRankStateSelect'), areaSel=document.getElementById('localRankAreaSelect');
  if(!stateSel || !areaSel) return;
  const {data:{user}}=await client.auth.getUser(); if(!user) return;
  const {data:me}=await client.from('profiles').select('local_state,local_city,local_area').eq('id',user.id).maybeSingle();
  const {data:rows}=await client.from('profiles').select('local_state,local_city,local_area').not('local_state','is',null);
  const states=[...new Set((rows||[]).map(x=>String(x.local_state||'').trim()).filter(Boolean))].sort();
  stateSel.innerHTML=states.map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join('') || '<option value="">No states available</option>';
  if(me?.local_state && states.some(x=>x.toLowerCase()===String(me.local_state).toLowerCase())) stateSel.value=states.find(x=>x.toLowerCase()===String(me.local_state).toLowerCase());
  const areas=[...new Set((rows||[]).flatMap(x=>[x.local_city,x.local_area]).filter(Boolean).map(x=>String(x).trim()))].sort();
  areaSel.innerHTML=areas.map(x=>`<option value="${escapeHTML(x)}">${escapeHTML(x)}</option>`).join('') || '<option value="">No local areas available</option>';
  const myArea=me?.local_area||me?.local_city; if(myArea && areas.some(x=>x.toLowerCase()===String(myArea).toLowerCase())) areaSel.value=areas.find(x=>x.toLowerCase()===String(myArea).toLowerCase());
}

// ==================== LEADERBOARD ====================
function getRank(winRate, points) {
    if (winRate >= 90 && points >= 10) return { rank: 'S', label: 'LEGEND', color: '#ffd700', emoji: '👑' };
    if (winRate >= 75 && points >= 7) return { rank: 'A', label: 'ELITE', color: '#00b894', emoji: '⭐' };
    if (winRate >= 60 && points >= 5) return { rank: 'B', label: 'PRO', color: '#00d2ff', emoji: '💪' };
    if (winRate >= 45 && points >= 3) return { rank: 'C', label: 'CONTENDER', color: '#fdcb6e', emoji: '📈' };
    if (winRate >= 30 && points >= 1) return { rank: 'D', label: 'RISING', color: '#e17055', emoji: '🏃' };
    return { rank: 'E', label: 'ROOKIE', color: '#636e72', emoji: '🌱' };
}

async function loadLeaderboard(filter){
    currentLeaderboardFilter = filter;

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.style.opacity = '0.5';
        btn.style.transform = 'scale(0.95)';
    });

    const btnId = filter === 'overall' ? 'lbOverall' :
                  filter === 'bca' ? 'lbBCA' :
                  filter === 'bba' ? 'lbBBA' : 'lbBCOM';
    const activeBtn = document.getElementById(btnId);
    if(activeBtn){
        activeBtn.style.opacity = '1';
        activeBtn.style.transform = 'scale(1)';
    }

    const list = document.getElementById('leaderboardList');
    const myRankCard = document.getElementById('myRankCard');
    list.innerHTML = "<div class='empty-box'>Loading global rankings...</div>";

    const { data: { user } } = await client.auth.getUser();
    if(!user) return;

    const activeBoard = normalizeBattlefield(currentBattlefield || 'local');
    // The legacy global leaderboard RPC is College-wide. Never use it for
    // Local/Gym, or it would leak College standings into those profiles.
    if(activeBoard !== 'college'){
        if(activeBoard === 'local'){
            const state=document.getElementById('localRankStateSelect')?.value||'';
            const area=document.getElementById('localRankAreaSelect')?.value||'';
            const profilesQuery=client.from('profiles').select('id,full_name,inter_rivalry_id,local_state,local_city,local_area');
            let {data:geoProfiles,error:geoError}=await profilesQuery;
            if(geoError){ list.innerHTML=`<div class='empty-box'>Unable to load Local rankings: ${escapeHTML(geoError.message)}</div>`; return; }
            geoProfiles=(geoProfiles||[]).filter(p=>localRankingMode==='state' ? (state && String(p.local_state||'').toLowerCase()===state.toLowerCase()) : (area && [p.local_city,p.local_area].some(v=>String(v||'').toLowerCase()===area.toLowerCase())));
            const ids=geoProfiles.map(p=>p.id);
            if(!ids.length){ list.innerHTML=`<div class='empty-box'>No players found for this ${localRankingMode==='state'?'state':'local area'} yet.</div>`; if(myRankCard) myRankCard.innerHTML=`<div class='empty-box'>📍 ${localRankingMode==='state'?'State':'Local area'} rankings</div>`; return; }
            const {data:completed,error:ce}=await client.from('challenges').select('challenger_id,opponent_id,rules,subcategory_id,subcategories(name,categories(name))').eq('status','completed');
            if(ce){list.innerHTML=`<div class='empty-box'>Unable to load results: ${escapeHTML(ce.message)}</div>`;return;}
            const set=new Set(ids), stats={}; ids.forEach(id=>stats[id]={wins:0,losses:0,draws:0,points:0});
            (completed||[]).forEach(c=>{if(!set.has(c.challenger_id)||!set.has(c.opponent_id))return; const r=c.rules||{}; const winner=r.winner_id; if(r.result==='draw'){stats[c.challenger_id].draws++;stats[c.opponent_id].draws++;} else if(winner===c.challenger_id){stats[c.challenger_id].wins++;stats[c.challenger_id].points+=3;stats[c.opponent_id].losses++;} else if(winner===c.opponent_id){stats[c.opponent_id].wins++;stats[c.opponent_id].points+=3;stats[c.challenger_id].losses++;}});
            const map=new Map(geoProfiles.map(p=>[p.id,p])); const ranked=ids.map(id=>({...map.get(id),...stats[id]})).filter(p=>p.wins+p.losses+p.draws>0).sort((a,b)=>b.points-a.points||b.wins-a.wins);
            if(myRankCard) myRankCard.innerHTML=`<div class='empty-box'>📍 ${localRankingMode==='state'?'State':'Local area'} ranking • ${escapeHTML(localRankingMode==='state'?state:area)}</div>`;
            list.innerHTML=ranked.length?ranked.map((p,i)=>`<div class='challenge-card'><strong>#${i+1} ${escapeHTML(p.full_name||'Player')}</strong><div class='challenge-info'>IR ID: ${escapeHTML(p.inter_rivalry_id||'-')}<br>Wins: ${p.wins} • Losses: ${p.losses} • Draws: ${p.draws}<br>Points: ${p.points}</div></div>`).join(''):`<div class='empty-box'>No completed challenges for this location yet.</div>`;
            return;
        }
        if(myRankCard) myRankCard.innerHTML = `<div class='empty-box'>🏋️ Gym rankings are calculated separately by skill.</div>`;
        await loadCategoryRankings('all', 'leaderboardList', 'lb', '#rankingsPage');
        return;
    }
    const courseFilter = filter === 'bca' ? 'BCA' :
                         filter === 'bba' ? 'BBA' :
                         filter === 'bcom' ? 'B.COM' : null;
    const { data: rows, error } = await client.rpc('get_global_leaderboard', { p_course: courseFilter });

    if(error){
        console.error('GLOBAL LEADERBOARD ERROR:', error);
        list.innerHTML = `<div class='empty-box'>Unable to load global rankings.<br>${escapeHTML(error.message)}</div>`;
        if(myRankCard) myRankCard.innerHTML = '';
        return;
    }

    if(!rows || rows.length === 0){
        list.innerHTML = "<div class='empty-box'>No students found.</div>";
        if(myRankCard) myRankCard.innerHTML = '';
        return;
    }

    const rankOrder = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };
    const rankColors = {
        S: '#ffd700',
        A: '#00b894',
        B: '#00d2ff',
        C: '#fdcb6e',
        D: '#e17055',
        E: '#636e72'
    };
    const rankEmojis = {
        S: '👑',
        A: '⭐',
        B: '💪',
        C: '📈',
        D: '🏃',
        E: '🌱'
    };
    const rankLabels = {
        S: 'LEGEND',
        A: 'ELITE',
        B: 'PRO',
        C: 'CONTENDER',
        D: 'RISING',
        E: 'ROOKIE'
    };

    // The RPC is already globally calculated. Sort once more on the
    // client so the visible position (#1, #2, #3...) is deterministic.
    const players = rows.map(row => ({
        ...row,
        wins: Number(row.wins || 0),
        losses: Number(row.losses || 0),
        draws: Number(row.draws || 0),
        total: Number(row.total_games || 0),
        points: Number(row.points || 0),
        winRate: Number(row.win_rate || 0),
        rank: row.rank || 'E',
        rankLabel: row.rank_label || rankLabels[row.rank] || 'ROOKIE'
    }));

    players.sort((a, b) => {
        const rankDiff = (rankOrder[a.rank] ?? 99) - (rankOrder[b.rank] ?? 99);
        if(rankDiff !== 0) return rankDiff;
        if(b.points !== a.points) return b.points - a.points;
        if(b.wins !== a.wins) return b.wins - a.wins;
        if(b.winRate !== a.winRate) return b.winRate - a.winRate;
        return String(a.full_name || '').localeCompare(String(b.full_name || ''));
    });

    // Competition position is global within the selected leaderboard.
    players.forEach((player, index) => {
        player.position = index + 1;
        player.rankColor = rankColors[player.rank] || '#636e72';
        player.rankEmoji = rankEmojis[player.rank] || '🌱';
        player.rankLabel = rankLabels[player.rank] || player.rankLabel || 'ROOKIE';
    });

    leaderboardData = players;

    const currentUser = players.find(player => player.user_id === user.id);
    if(currentUser && myRankCard){
        currentUserRank = currentUser;
        const rankInfo = {
            rank: currentUser.rank,
            label: currentUser.rankLabel,
            color: currentUser.rankColor,
            emoji: currentUser.rankEmoji
        };

        const yearLabel = currentUser.year_of_study === 1 ? '1st Year' :
                          currentUser.year_of_study === 2 ? '2nd Year' :
                          currentUser.year_of_study === 3 ? '3rd Year' :
                          currentUser.year_of_study ? `${currentUser.year_of_study}th Year` : '';

        myRankCard.innerHTML = `
            <div style="background:linear-gradient(135deg, #1a1a2e, #16213e);border:2px solid ${rankInfo.color};border-radius:16px;padding:25px;text-align:center;">
                <div style="font-size:14px;color:#888;margin-bottom:5px;">YOUR GLOBAL RANK</div>
                <div style="font-size:18px;font-weight:800;color:#888;margin-bottom:5px;">#${currentUser.position} OF ${players.length}</div>
                <div style="font-size:60px;font-weight:900;color:${rankInfo.color};line-height:1;">${rankInfo.rank}</div>
                <div style="font-size:20px;font-weight:700;color:${rankInfo.color};margin-top:5px;">${rankInfo.emoji} ${rankInfo.label}</div>
                <div style="display:flex;justify-content:center;gap:30px;margin-top:15px;flex-wrap:wrap;">
                    <div><span style="color:#888;">Points</span><br><span style="font-size:20px;font-weight:700;color:#00d2ff;">${currentUser.points}</span></div>
                    <div><span style="color:#888;">Wins</span><br><span style="font-size:20px;font-weight:700;color:#00b894;">${currentUser.wins}</span></div>
                    <div><span style="color:#888;">Losses</span><br><span style="font-size:20px;font-weight:700;color:#e17055;">${currentUser.losses}</span></div>
                    <div><span style="color:#888;">Draws</span><br><span style="font-size:20px;font-weight:700;color:#111;">${currentUser.draws}</span></div>
                    <div><span style="color:#888;">Win Rate</span><br><span style="font-size:20px;font-weight:700;color:${rankInfo.color};">${currentUser.winRate}%</span></div>
                </div>
                ${(currentUser.course || yearLabel || currentUser.specialization || currentUser.college_name) ? `<div style="margin-top:10px;color:#888;font-size:14px;">${escapeHTML(currentUser.course || '')}${yearLabel ? ' • ' + escapeHTML(yearLabel) : ''}${currentUser.specialization ? ' • ' + escapeHTML(currentUser.specialization) : ''}${currentUser.college_name ? ' • ' + escapeHTML(currentUser.college_name) : ''}</div>` : ''}
            </div>
        `;
    } else if(myRankCard){
        myRankCard.innerHTML = "";
    }

    if(!players.length){
        list.innerHTML = "<div class='empty-box'>No players found in this category.</div>";
        return;
    }

    let html = '';

    players.forEach(player => {
        const isCurrentUser = player.user_id === user.id;
        const rankColor = player.rankColor;
        const yearLabel = player.year_of_study === 1 ? '1st Year' :
                          player.year_of_study === 2 ? '2nd Year' :
                          player.year_of_study === 3 ? '3rd Year' :
                          player.year_of_study ? `${player.year_of_study}th Year` : '';

        html += `
            <div style="background:${isCurrentUser ? '#1a1a2e' : '#121212'};border:2px solid ${isCurrentUser ? rankColor : '#292929'};border-radius:12px;padding:16px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:15px;">
                <div style="display:flex;align-items:center;gap:15px;min-width:0;">
                    <div style="font-size:28px;font-weight:900;color:${rankColor};min-width:55px;text-align:center;line-height:1;">
                        #${player.position}
                        <div style="font-size:18px;margin-top:5px;">${player.rank}</div>
                    </div>
                    <div style="min-width:0;">
                        <div style="font-weight:700;font-size:18px;">${isCurrentUser ? '⭐ ' : ''}${escapeHTML(player.full_name || 'Unknown')}${isCurrentUser ? '<span style="font-size:12px;color:#00d2ff;margin-left:8px;">(YOU)</span>' : ''}</div>
                        <div style="font-size:12px;color:#888;">ID: ${escapeHTML(player.inter_rivalry_id || '-')}</div>
                        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
                            ${player.course ? `<span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:#888;">${escapeHTML(player.course)}</span>` : ''}
                            ${yearLabel ? `<span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:#888;">${escapeHTML(yearLabel)}</span>` : ''}
                            ${player.specialization ? `<span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:#888;">🎯 ${escapeHTML(player.specialization)}</span>` : ''}
                            ${player.college_name ? `<span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:#888;">🎓 ${escapeHTML(player.college_name)}</span>` : ''}
                            <span style="background:#1a1a1a;padding:2px 10px;border-radius:999px;font-size:11px;color:${rankColor};font-weight:700;">${player.rankEmoji} ${player.rankLabel}</span>
                        </div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:15px;flex-wrap:wrap;">
                    <div style="text-align:center;"><div style="font-size:20px;font-weight:900;color:#00d2ff;">${player.points}</div><div style="font-size:10px;color:#888;">Points</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#00b894;">${player.wins}</div><div style="font-size:10px;color:#888;">W</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#e17055;">${player.losses}</div><div style="font-size:10px;color:#888;">L</div></div>
                    <div style="text-align:center;"><div style="font-size:16px;font-weight:700;color:#111;">${player.draws}</div><div style="font-size:10px;color:#888;">D</div></div>
                    <div style="text-align:center;min-width:55px;"><div style="font-size:18px;font-weight:900;color:${rankColor};">${player.winRate}%</div><div style="font-size:10px;color:#888;">Win Rate</div></div>
                    <button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:10px;" onclick="viewProfile('${player.user_id}')">👤 VIEW</button>
                </div>
            </div>
        `;
    });

    list.innerHTML = html;
}
// ==================== CATEGORY RANKINGS ====================
function getCategoryEmoji(category) {
    const emojis = {
        'Sports': '🏏',
        'Education': '🎓',
        'Culture': '🎭',
        'Gaming': '🎮',
        'Technology': '💻',
        'MMA': '🥊'
    };
    return emojis[category] || '🏆';
}

async function loadCategoryRankings(category, listId = 'categoryRankingsList', filterPrefix = 'catFilter', filterScope = '#categoryRankingsPage') {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = "<div class='empty-box'>Loading category rankings...</div>";
    
    document.querySelectorAll(filterScope + ' .filter-btn').forEach(btn => {
        btn.style.opacity = '0.5';
        btn.style.transform = 'scale(0.95)';
    });
    const btnId = `${filterPrefix}${category === 'all' ? 'All' : category}`;
    const activeBtn = document.getElementById(btnId);
    if (activeBtn) {
        activeBtn.style.opacity = '1';
        activeBtn.style.transform = 'scale(1)';
    }
    
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const rankingBattlefield = normalizeBattlefield(currentBattlefield || 'college');
    const rankingScope = await getBattlefieldMemberIds(rankingBattlefield, user.id);
    const rankingIds = new Set(rankingScope.ids);
    if(!rankingIds.size){ list.innerHTML = `<div class='empty-box'>Join an approved ${rankingBattlefield} battlefield to see its rankings.</div>`; return; }
    
    const { data: challenges, error } = await client
        .from("challenges")
        .select(`
            challenger_id,
            opponent_id,
            status,
            rules,
            subcategory_id,
            battlefield_type,
            community_id,
            subcategories (
                id,
                name,
                categories (
                    id,
                    name
                )
            )
        `)
        .eq("status", "completed");
    const scopedChallenges = (challenges || []).filter(c => {
        const a = c.challenger_id, b = c.opponent_id;
        if(!rankingIds.has(a) || !rankingIds.has(b)) return false;
        return challengeBelongsToBattlefield(c, rankingBattlefield, rankingScope.communityId);
    });
    
    if (error || scopedChallenges.length === 0) {
        list.innerHTML = "<div class='empty-box'>No completed challenges yet. Start competing to see rankings!</div>";
        return;
    }
    
    const { data: profiles } = await client
        .from("profiles")
        .select("id, full_name, inter_rivalry_id, role")
        .in("id", [...rankingIds]);
    
    if (!profiles) return;
    
    let memberships = [];
    if(rankingBattlefield === 'college'){
        const { data } = await client
            .from("college_memberships")
            .select("user_id, course, year_of_study, specialization, colleges(college_name)")
            .in("user_id", profiles.map(p => p.id))
            .eq("college_id", rankingScope.collegeId)
            .eq("is_active", true);
        memberships = data || [];
    }else{
        const { data } = await client
            .from("community_memberships")
            .select("user_id, communities(name,location_area)")
            .in("user_id", profiles.map(p => p.id))
            .eq("community_id", rankingScope.communityId)
            .eq("status", "approved");
        memberships = data || [];
    }
    
    const userMap = {};
    profiles.forEach(p => {
        const membership = memberships?.find(m => m.user_id === p.id) || {};
        userMap[p.id] = {
            ...p,
            course: membership?.course || 'Unknown',
            year: membership?.year_of_study || null,
            specialization: membership?.specialization || null,
            college: rankingBattlefield === 'college'
                ? (membership?.colleges?.college_name || 'Unknown')
                : (membership?.communities?.name || 'Unknown')
        };
    });
    
    const categoryStats = {};
    const userStats = {};
    
    scopedChallenges.forEach(c => {
        const challengerId = c.challenger_id;
        const opponentId = c.opponent_id;
        const rules = c.rules || {};
        const subcategory = c.subcategories;
        const categoryName = subcategory?.categories?.name || 'Unknown';
        const gameName = subcategory?.name || 'Unknown';
        
        if (!categoryStats[categoryName]) {
            categoryStats[categoryName] = {};
        }
        if (!categoryStats[categoryName][gameName]) {
            categoryStats[categoryName][gameName] = {};
        }
        
        if (rules.team_challenge && Array.isArray(rules.team_a_members) && Array.isArray(rules.team_b_members)) {
            const teamAIds = rules.team_a_members.map(m => m.id || m.user_id).filter(Boolean);
            const teamBIds = rules.team_b_members.map(m => m.id || m.user_id).filter(Boolean);

            const ensureStats = (id) => {
                if(!userStats[id]) userStats[id] = { wins: 0, losses: 0, draws: 0, total: 0, games: {} };
                if(!userStats[id].games[gameName]) userStats[id].games[gameName] = { wins: 0, losses: 0, draws: 0, total: 0 };
            };

            if(rules.result === "draw"){
                [...teamAIds, ...teamBIds].forEach(id => {
                    ensureStats(id);
                    userStats[id].draws++;
                    userStats[id].total++;
                    userStats[id].games[gameName].draws++;
                    userStats[id].games[gameName].total++;
                });
            }else if(rules.result === "team_challenger_win" || rules.team_result === "team_challenger_win"){
                teamAIds.forEach(id => {
                    ensureStats(id);
                    userStats[id].wins++;
                    userStats[id].total++;
                    userStats[id].games[gameName].wins++;
                    userStats[id].games[gameName].total++;
                    categoryStats[categoryName][gameName][id] = (categoryStats[categoryName][gameName][id] || 0) + 1;
                });
                teamBIds.forEach(id => {
                    ensureStats(id);
                    userStats[id].losses++;
                    userStats[id].total++;
                    userStats[id].games[gameName].losses++;
                    userStats[id].games[gameName].total++;
                });
            }else if(rules.result === "team_opponent_win" || rules.team_result === "team_opponent_win"){
                teamBIds.forEach(id => {
                    ensureStats(id);
                    userStats[id].wins++;
                    userStats[id].total++;
                    userStats[id].games[gameName].wins++;
                    userStats[id].games[gameName].total++;
                    categoryStats[categoryName][gameName][id] = (categoryStats[categoryName][gameName][id] || 0) + 1;
                });
                teamAIds.forEach(id => {
                    ensureStats(id);
                    userStats[id].losses++;
                    userStats[id].total++;
                    userStats[id].games[gameName].losses++;
                    userStats[id].games[gameName].total++;
                });
            }

        } else if (rules.winner_id) {
            const winnerId = rules.winner_id;
            const loserId = winnerId === challengerId ? opponentId : challengerId;
            
            if (!userStats[winnerId]) {
                userStats[winnerId] = { wins: 0, losses: 0, draws: 0, total: 0, games: {} };
            }
            if (!userStats[winnerId].games[gameName]) {
                userStats[winnerId].games[gameName] = { wins: 0, losses: 0, draws: 0, total: 0 };
            }
            userStats[winnerId].wins++;
            userStats[winnerId].total++;
            userStats[winnerId].games[gameName].wins++;
            userStats[winnerId].games[gameName].total++;
            
            if (!userStats[loserId]) {
                userStats[loserId] = { wins: 0, losses: 0, draws: 0, total: 0, games: {} };
            }
            if (!userStats[loserId].games[gameName]) {
                userStats[loserId].games[gameName] = { wins: 0, losses: 0, draws: 0, total: 0 };
            }
            userStats[loserId].losses++;
            userStats[loserId].total++;
            userStats[loserId].games[gameName].losses++;
            userStats[loserId].games[gameName].total++;
            
            if (!categoryStats[categoryName][gameName][winnerId]) {
                categoryStats[categoryName][gameName][winnerId] = 0;
            }
            categoryStats[categoryName][gameName][winnerId]++;
            
        } else if (rules.result === 'draw') {
            [challengerId, opponentId].forEach(id => {
                if (!userStats[id]) {
                    userStats[id] = { wins: 0, losses: 0, draws: 0, total: 0, games: {} };
                }
                if (!userStats[id].games[gameName]) {
                    userStats[id].games[gameName] = { wins: 0, losses: 0, draws: 0, total: 0 };
                }
                userStats[id].draws++;
                userStats[id].total++;
                userStats[id].games[gameName].draws++;
                userStats[id].games[gameName].total++;
            });
        }
    });
    
    Object.keys(userStats).forEach(userId => {
        const stats = userStats[userId];
        stats.winRate = stats.total > 0 ? Math.round((stats.wins / stats.total) * 100) : 0;
        Object.keys(stats.games).forEach(gameName => {
            const game = stats.games[gameName];
            game.winRate = game.total > 0 ? Math.round((game.wins / game.total) * 100) : 0;
            const rankInfo = getRank(game.winRate, game.wins * 3 + game.draws);
            game.rank = rankInfo.rank;
            game.rankLabel = rankInfo.label;
            game.rankColor = rankInfo.color;
            game.rankEmoji = rankInfo.emoji;
        });
    });
    
    let html = '';
    const categories = Object.keys(categoryStats).sort();
    const filteredCategories = category === 'all' ? categories : categories.filter(c => c === category);
    
    if (filteredCategories.length === 0) {
        list.innerHTML = `<div class='empty-box'>No rankings found for ${category} category.</div>`;
        return;
    }
    
    filteredCategories.forEach(catName => {
        const games = Object.keys(categoryStats[catName]).sort();
        
        html += `
            <div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:23px;margin-bottom:20px;">
                <h2 style="color:#111;margin-bottom:15px;display:flex;align-items:center;gap:10px;">
                    <span style="font-size:28px;">${getCategoryEmoji(catName)}</span>
                    ${escapeHTML(catName)}
                    <span style="font-size:14px;color:#888;font-weight:400;">(${games.length} games)</span>
                </h2>
                <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(350px,1fr));gap:20px;">
        `;
        
        games.forEach(gameName => {
            const players = categoryStats[catName][gameName];
            const playerIds = Object.keys(players);
            playerIds.sort((a, b) => players[b] - players[a]);
            const topPlayers = playerIds.slice(0, 10);
            
            html += `
                <div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:16px;">
                    <h3 style="color:#00d2ff;margin-bottom:12px;font-size:16px;">🎯 ${escapeHTML(gameName)}</h3>
                    <div style="display:flex;flex-direction:column;gap:6px;">
            `;
            
            if (topPlayers.length === 0) {
                html += `<div style="color:#888;font-size:12px;text-align:center;padding:10px;">No players yet</div>`;
            } else {
                topPlayers.forEach((playerId, index) => {
                    const player = userMap[playerId];
                    const stats = userStats[playerId];
                    const gameStats = stats?.games[gameName] || { wins: 0, losses: 0, draws: 0, total: 0, winRate: 0, rank: 'E', rankColor: '#636e72', rankEmoji: '🌱' };
                    const wins = players[playerId] || 0;
                    
                    let medal = '';
                    let bgColor = '#0a0a0a';
                    if (index === 0) { medal = '🥇'; bgColor = '#1a1508'; }
                    else if (index === 1) { medal = '🥈'; bgColor = '#151515'; }
                    else if (index === 2) { medal = '🥉'; bgColor = '#1a0f0a'; }
                    
                    html += `
                        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${bgColor};border-radius:8px;border-left:3px solid ${gameStats.rankColor || '#636e72'};">
                            <div style="display:flex;align-items:center;gap:10px;">
                                <span style="font-size:16px;min-width:30px;">${medal || `#${index + 1}`}</span>
                                <div>
                                    <span style="font-weight:600;">${escapeHTML(player?.full_name || 'Unknown')}</span>
                                    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:2px;">
                                        <span style="font-size:10px;color:#888;">${escapeHTML(player?.course || '')}</span>
                                        <span style="font-size:10px;color:${gameStats.rankColor || '#636e72'};font-weight:700;">${gameStats.rankEmoji || '🌱'} ${gameStats.rank || 'E'}</span>
                                    </div>
                                </div>
                            </div>
                            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
                                <div style="text-align:center;min-width:28px;">
                                    <span style="font-size:15px;font-weight:800;color:#00b894;">${gameStats.wins || 0}</span>
                                    <div style="font-size:9px;color:#888;">W</div>
                                </div>
                                <div style="text-align:center;min-width:28px;">
                                    <span style="font-size:15px;font-weight:800;color:#e17055;">${gameStats.losses || 0}</span>
                                    <div style="font-size:9px;color:#888;">L</div>
                                </div>
                                <div style="text-align:center;min-width:28px;">
                                    <span style="font-size:15px;font-weight:800;color:#111;">${gameStats.draws || 0}</span>
                                    <div style="font-size:9px;color:#888;">D</div>
                                </div>
                                <div style="text-align:center;min-width:48px;">
                                    <span style="font-size:14px;font-weight:600;color:${gameStats.rankColor || '#636e72'};">${gameStats.winRate || 0}%</span>
                                    <div style="font-size:9px;color:#888;">Rate</div>
                                </div>
                                <button class="btn-3d-xs-white-glow" style="width:auto;padding:3px 10px;font-size:9px;" onclick="viewProfile('${playerId}')">VIEW</button>
                            </div>
                        </div>
                    `;
                });
            }
            
            if (playerIds.length > 10) {
                html += `<div style="text-align:center;margin-top:6px;"><span style="font-size:11px;color:#555;">+${playerIds.length - 10} more players</span></div>`;
            }
            
            html += `
                    </div>
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    list.innerHTML = html;
}

async function loadMergedCategoryRankings(category){
    return loadCategoryRankings(category, 'mergedCategoryRankingsList', 'mergedCatFilter', '#mergedCategoryRankingPanel');
}

// ==================== TOURNAMENT FUNCTIONS ====================
async function loadTournaments(filter) {
    const list = document.getElementById("tournamentsList");
    list.innerHTML = "<div class='empty-box'>Loading tournaments...</div>";
    
    const { data: { user } } = await client.auth.getUser();
    if (user) {
        const { count: inviteCount } = await client.from('tournament_squad_invites').select('id',{count:'exact',head:true}).eq('invitee_id',user.id).eq('status','pending');
        const inviteBadge = document.getElementById('tournamentSquadInviteBadge');
        if (inviteBadge) inviteBadge.textContent = inviteCount ? `(${inviteCount})` : '';
    }
    if (user) {
        const { data: profile } = await client.from("profiles").select("role").eq("id", user.id).single();
        currentUserRole = profile?.role || '';
        const normalizedTournamentRole = String(currentUserRole).toLowerCase().replace(/[\s-]/g, "_");
        const adminControls = document.getElementById("tournamentAdminControls");
        if (adminControls) {
            adminControls.style.display = (["super_admin", "college_admin"].includes(normalizedTournamentRole)) ? 'block' : 'none';
        }
    }
    
    document.querySelectorAll('#tournamentsPage .filter-btn').forEach(btn => {
        btn.style.opacity = '0.5';
        btn.style.transform = 'scale(0.95)';
    });
    const btnId = `tournFilter${filter.charAt(0).toUpperCase() + filter.slice(1)}`;
    const activeBtn = document.getElementById(btnId);
    if (activeBtn) {
        activeBtn.style.opacity = '1';
        activeBtn.style.transform = 'scale(1)';
    }
    
    const tournamentBattlefield = (typeof normalizeBattlefield==='function' ? normalizeBattlefield(currentBattlefield||'local') : (currentBattlefield||'local'));
    let query = client.from("tournaments").select(`
        *,
        profiles!tournaments_created_by_fkey(full_name, inter_rivalry_id)
    `).eq('battlefield', tournamentBattlefield);
    
    if (filter !== 'all') {
        query = query.eq("status", filter);
    }
    
    const { data, error } = await query.order("start_date", { ascending: true });
    
    if (error) {
        list.innerHTML = `<div class='empty-box'>Error: ${escapeHTML(error.message)}</div>`;
        return;
    }
    
    if (!data || data.length === 0) {
        list.innerHTML = `<div class='empty-box'>No ${filter !== 'all' ? filter + ' ' : ''}${tournamentBattlefield.charAt(0).toUpperCase()+tournamentBattlefield.slice(1)} tournaments found.</div>`;
        return;
    }
    
    list.innerHTML = "";
    
    for (const tournament of data) {
        if (tournament.tournament_format === 'table') await generateTournamentTableIfDue(tournament);
        let isRegistered = false;
        let isFull = false;
        let participantCount = 0;
        let isRegisteredSquadCaptain = false;
        
        if (user) {
            const { count } = await client
                .from("tournament_participants")
                .select("id", { count: "exact", head: true })
                .eq("tournament_id", tournament.id);
            participantCount = count || 0;
            isFull = participantCount >= tournament.max_players;
            
            const { data: reg } = await client
                .from("tournament_participants")
                .select("id,is_squad_captain,squad_name")
                .eq("tournament_id", tournament.id)
                .eq("user_id", user.id)
                .maybeSingle();
            isRegistered = !!reg;
            isRegisteredSquadCaptain = !!(reg && reg.is_squad_captain && reg.squad_name);
        }
        
        const statusColors = {
            'upcoming': '#fdcb6e',
            'ongoing': '#00d2ff',
            'completed': '#00b894'
        };
        const statusEmojis = {
            'upcoming': '⏳',
            'ongoing': '⚡',
            'completed': '✅'
        };
        
        const tournamentDate = tournament.tournament_date || (tournament.start_date ? new Date(tournament.start_date).toLocaleDateString("en-CA", {timeZone:"Asia/Kolkata"}) : "");
        const todayIST = new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Kolkata"});
        const isTournamentDay = !!tournamentDate && tournamentDate === todayIST;
        const isCreator = !!user && tournament.created_by === user.id;
        const roomHtml = isTournamentDay ? `
            <div style="margin-top:14px;padding:14px;border:1px solid #333;border-radius:14px;background:rgba(255,255,255,.03);">
                <div style="font-weight:800;margin-bottom:10px;">🎮 TODAY'S TOURNAMENT ROOM</div>
                ${tournament.room_id ? `<div style="margin:6px 0;"><strong>Room ID:</strong> <span style="color:#00d2ff;font-weight:800;">${escapeHTML(tournament.room_id)}</span></div>` : ''}
                ${tournament.room_password ? `<div style="margin:6px 0;"><strong>Password:</strong> <span style="color:#00b894;font-weight:800;">${escapeHTML(tournament.room_password)}</span></div>` : ''}
                ${tournament.scanner_url ? `<div style="margin-top:10px;text-align:center;"><img src="${escapeHTML(tournament.scanner_url)}" alt="Tournament room QR" style="max-width:260px;max-height:260px;width:100%;object-fit:contain;border-radius:14px;border:1px solid #333;background:#fff;padding:8px;"></div>` : ''}
                ${(!tournament.room_id && !tournament.room_password && !tournament.scanner_url) ? `<div style="color:#888;font-size:12px;">Room details have not been added yet.</div>` : ''}
                ${isCreator ? `
                    <div style="margin-top:14px;padding-top:12px;border-top:1px solid #333;">
                        <div style="font-size:12px;color:#aaa;margin-bottom:8px;">🔐 Creator controls — available only today</div>
                        <input id="roomId_${tournament.id}" value="${escapeHTML(tournament.room_id || '')}" placeholder="🎮 Room ID" style="width:100%;margin-bottom:8px;padding:10px;border-radius:10px;border:1px solid #444;background:#111;color:#fff;box-sizing:border-box;">
                        <input id="roomPassword_${tournament.id}" value="${escapeHTML(tournament.room_password || '')}" placeholder="🔐 Room Password" style="width:100%;margin-bottom:8px;padding:10px;border-radius:10px;border:1px solid #444;background:#111;color:#fff;box-sizing:border-box;">
                        <label style="display:block;font-size:12px;color:#aaa;margin:6px 0;">📲 Upload QR / Room Image</label>
                        <input id="scannerFile_${tournament.id}" type="file" accept="image/png,image/jpeg,image/webp" style="width:100%;margin-bottom:8px;color:#ddd;">
                        <button class="btn-3d-sm-white-glow" type="button" onclick="updateTournamentRoom('${tournament.id}')" style="width:auto;padding:7px 14px;">💾 SAVE ROOM + QR</button>
                        ${tournament.scanner_url ? `<button class="btn-3d-sm-white-glow-danger" type="button" onclick="removeTournamentScanner('${tournament.id}')" style="width:auto;padding:7px 14px;margin-left:6px;">🗑️ REMOVE QR</button>` : ''}
                    </div>` : ''}
            </div>` : '';

        const card = document.createElement("div");
        card.className = "challenge-card";
        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
                <div>
                    <h3>🏆 ${escapeHTML(tournament.title)}</h3>
                    <div class="challenge-info">
                        <strong>Category:</strong> ${escapeHTML(tournament.category)} • ${escapeHTML(tournament.game)}
                        <br><strong>Mode:</strong> ${tournament.tournament_mode === 'squad' ? '👥 Squad' : '👤 Solo'}
                        <br><strong>Created by:</strong> ${escapeHTML(tournament.profiles?.full_name || 'Unknown')}
                        <br><strong>Players:</strong> ${participantCount}/${tournament.max_players}
                        <br><strong>Starts:</strong> ${formatDate(tournament.start_date)}
                        <br><strong>Ends:</strong> ${formatDate(tournament.end_date)}
                        ${tournament.prize ? `<br><strong>🏅 Prize:</strong> ${escapeHTML(tournament.prize)}` : ''}
                        ${tournament.description ? `<br><strong>Description:</strong> ${escapeHTML(tournament.description)}` : ''}
                        ${tournament.rules ? `<br><strong>Rules:</strong> ${escapeHTML(tournament.rules)}` : ''}
                    </div>
                </div>
                <div style="text-align:right;">
                    <span class="status-pill status-${escapeHTML(tournament.status)}" style="background:${statusColors[tournament.status] || '#888'};color:${tournament.status === 'upcoming' ? '#2d3436' : 'white'};">
                        ${statusEmojis[tournament.status]} ${escapeHTML(tournament.status)}
                    </span>
                    <div style="margin-top:10px;">
                        ${tournament.status !== 'completed' && !isFull && !isRegistered ? 
                            `<button class="btn-3d-sm-white-glow" onclick="openTournamentRegistration('${tournament.id}')" style="width:auto;padding:6px 16px;">📝 REGISTER</button>` : ''}
                        ${isRegistered && tournament.status !== 'completed' ? 
                            `<button class="btn-3d-sm-white-glow-danger" onclick="leaveTournament('${tournament.id}')" style="width:auto;padding:6px 16px;">🚪 LEAVE</button>` : ''}
                        ${isRegistered && isRegisteredSquadCaptain && tournament.tournament_mode === 'squad' && tournament.status !== 'completed' ?
                            `<button class="btn-3d-sm-white-glow" onclick="openTournamentRegistration('${tournament.id}')" style="width:auto;padding:6px 12px;margin-top:6px;">📨 TEAM INVITES</button>` : ''}
                        ${isFull && !isRegistered && tournament.status !== 'completed' ? 
                            `<span style="color:#ff6b6b;font-size:12px;">🔴 FULL</span>` : ''}
                        ${tournament.status === 'completed' && isRegistered ? 
                            `<span style="color:#00b894;">✅ Participated</span>` : ''}
                        ${Array.isArray(tournament.winner_ids) && tournament.winner_ids.length ? `<div style="margin-top:8px;color:#00d2ff;font-weight:800;">🏆 Winner${tournament.winner_ids.length>1?'s':''} selected (${tournament.winner_ids.length})</div>` : ''}
                        ${user && tournament.created_by === user.id && tournament.status !== 'completed' ?
                            `<button class="btn-3d-sm-white-glow" onclick="markTournamentFinished('${tournament.id}')" style="width:auto;padding:6px 16px;margin:6px 0 0 6px;">✅ TOURNAMENT FINISHED</button>` : ''}
                        ${user && tournament.created_by === user.id ?
                            `<button class="btn-3d-sm-white-glow" onclick="openTournamentWinners('${tournament.id}')" style="width:auto;padding:6px 16px;margin:6px 0 0 6px;">🏆 CHOOSE WINNER(S)</button>` : ''}
                        ${user && tournament.created_by === user.id ?
                            `<button class="btn-3d-sm-white-glow" onclick="openTournamentParticipants('${tournament.id}')" style="width:auto;padding:6px 16px;margin:6px 0 0 6px;">👥 PARTICIPANTS</button>` : ''}
                        ${user && tournament.created_by === user.id ?
                            `<button class="btn-3d-sm-white-glow-danger" onclick="deleteTournament('${tournament.id}')" style="width:auto;padding:6px 16px;margin:6px 0 0 6px;">🗑️ DELETE THIS TOURNAMENT</button>` : ''}
                    </div>
                </div>
            </div>
            ${roomHtml}
        `;
        list.appendChild(card);
    }
}

let tournamentWinnersCurrentId = null;

function closeTournamentWinners(){
  tournamentWinnersCurrentId = null;
  const modal=document.getElementById('tournamentWinnersModal');
  if(modal) modal.style.display='none';
}

async function openTournamentWinners(tournamentId){
  const {data:{user}}=await client.auth.getUser();
  if(!user) return alert('Please login first.');
  const {data:tournament,error:tErr}=await client.from('tournaments').select('id,title,created_by,tournament_mode,winner_ids').eq('id',tournamentId).maybeSingle();
  if(tErr||!tournament) return alert('Could not load tournament.');
  if(tournament.created_by!==user.id) return alert('Only the tournament creator can select winners.');
  const {data:participants,error}=await client.from('tournament_participants').select('user_id,full_name,squad_name,squad_captain_id,is_squad_captain').eq('tournament_id',tournamentId).order('registered_at',{ascending:true});
  if(error) return alert('Could not load participants: '+error.message);
  let entries=participants||[];
  if(tournament.tournament_mode==='squad'){
    const seen=new Set();
    entries=entries.filter(x=>{const key=x.squad_captain_id||x.user_id;if(seen.has(key))return false;seen.add(key);return x.is_squad_captain||!x.squad_captain_id||x.squad_captain_id===x.user_id;});
  }
  if(!entries.length) return alert('No registered participants are available to choose as winners.');
  tournamentWinnersCurrentId=tournamentId;
  document.getElementById('tournamentWinnersTitle').textContent='🏆 Winners — '+(tournament.title||'Tournament');
  const selected=new Set(Array.isArray(tournament.winner_ids)?tournament.winner_ids:[]);
  document.getElementById('tournamentWinnersOptions').innerHTML=entries.map((x,i)=>{
    const id=String(x.user_id||'');
    const label=tournament.tournament_mode==='squad'?(x.squad_name||x.full_name||('Squad '+(i+1))):(x.full_name||('Participant '+(i+1)));
    return `<label style="display:flex;align-items:center;gap:10px;padding:12px;border:1px solid #383838;border-radius:12px;color:#fff;background:#111;"><input type="checkbox" class="tournament-winner-check" value="${escapeHTML(id)}" ${selected.has(id)?'checked':''} style="width:18px;height:18px;"> <span>${escapeHTML(label)}${tournament.tournament_mode==='squad'?' — Squad':''}</span></label>`;
  }).join('');
  document.getElementById('tournamentWinnersMessage').textContent='';
  document.getElementById('tournamentWinnersModal').style.display='flex';
}

async function saveTournamentWinners(){
  const tournamentId=tournamentWinnersCurrentId;
  if(!tournamentId) return;
  const {data:{user}}=await client.auth.getUser();
  if(!user) return alert('Please login first.');
  const {data:tournament,error:loadErr}=await client.from('tournaments').select('id,created_by').eq('id',tournamentId).maybeSingle();
  if(loadErr||!tournament||tournament.created_by!==user.id) return alert('Only the tournament creator can save winners.');
  const winners=Array.from(document.querySelectorAll('.tournament-winner-check:checked')).map(el=>el.value).filter(Boolean);
  if(!winners.length){document.getElementById('tournamentWinnersMessage').textContent='Select at least one winner.';return;}
  const {error}=await client.from('tournaments').update({winner_ids:winners}).eq('id',tournamentId).eq('created_by',user.id);
  if(error){document.getElementById('tournamentWinnersMessage').textContent='Could not save winners: '+error.message;return;}
  closeTournamentWinners();
  await loadTournaments('all');
  alert('🏆 Winner(s) saved successfully!');
}

async function markTournamentFinished(tournamentId){
  const {data:{user}}=await client.auth.getUser();
  if(!user) return alert('Please login first.');
  if(!confirm('Mark this tournament as finished? Participants will no longer be able to register.')) return;
  const {data:tournament,error:loadErr}=await client.from('tournaments').select('id,created_by').eq('id',tournamentId).maybeSingle();
  if(loadErr||!tournament||tournament.created_by!==user.id) return alert('Only the tournament creator can finish this tournament.');
  const {error}=await client.from('tournaments').update({status:'completed'}).eq('id',tournamentId).eq('created_by',user.id);
  if(error) return alert('Could not finish tournament: '+error.message);
  await loadTournaments('all');
  alert('✅ Tournament marked as finished. Now choose the winner(s) using the winner button.');
}

async function updateTournamentRoom(tournamentId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return alert("Please login first.");

    const { data: tournament, error: loadError } = await client
        .from("tournaments")
        .select("id,created_by,tournament_date,start_date")
        .eq("id", tournamentId)
        .maybeSingle();

    if (loadError || !tournament) return alert("Could not load tournament.");
    if (tournament.created_by !== user.id) return alert("Only the tournament creator can set the room.");

    const tournamentDate = tournament.tournament_date || (tournament.start_date ? new Date(tournament.start_date).toLocaleDateString("en-CA", {timeZone:"Asia/Kolkata"}) : "");
    const todayIST = new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Kolkata"});
    if (!tournamentDate || tournamentDate !== todayIST) {
        return alert("Room ID, password and QR can only be added on the tournament date.");
    }

    const roomId = (document.getElementById(`roomId_${tournamentId}`)?.value || "").trim();
    const roomPassword = (document.getElementById(`roomPassword_${tournamentId}`)?.value || "").trim();
    const file = document.getElementById(`scannerFile_${tournamentId}`)?.files?.[0] || null;

    if (file && file.size > 6 * 1024 * 1024) {
        return alert("QR / room image must be 6 MB or smaller.");
    }

    let scannerUrl = null;
    if (file) {
        const ext = (file.name.split(".").pop() || "png").toLowerCase();
        const safeExt = ["png","jpg","jpeg","webp"].includes(ext) ? ext : "png";
        const path = `${tournamentId}/room-${Date.now()}.${safeExt}`;

        const { error: uploadError } = await client
            .storage
            .from("tournament-scanners")
            .upload(path, file, {
                cacheControl: "3600",
                upsert: false,
                contentType: file.type || "image/png"
            });

        if (uploadError) {
            return alert("QR upload failed: " + uploadError.message + "\n\nMake sure the tournament-scanners bucket and its upload policy are created in Supabase.");
        }

        const { data: publicData } = client
            .storage
            .from("tournament-scanners")
            .getPublicUrl(path);
        scannerUrl = publicData?.publicUrl || null;
    }

    const update = { room_id: roomId || null, room_password: roomPassword || null };
    if (scannerUrl) update.scanner_url = scannerUrl;

    const { error } = await client
        .from("tournaments")
        .update(update)
        .eq("id", tournamentId)
        .eq("created_by", user.id);

    if (error) return alert("Could not save room details: " + error.message);

    alert("✅ Room details saved!");
    await loadTournaments("all");
}

async function removeTournamentScanner(tournamentId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return alert("Please login first.");

    const { data: tournament } = await client
        .from("tournaments")
        .select("id,created_by,tournament_date,start_date")
        .eq("id", tournamentId)
        .maybeSingle();

    if (!tournament || tournament.created_by !== user.id) return alert("Only the tournament creator can remove the QR.");

    const tournamentDate = tournament.tournament_date || (tournament.start_date ? new Date(tournament.start_date).toLocaleDateString("en-CA", {timeZone:"Asia/Kolkata"}) : "");
    const todayIST = new Date().toLocaleDateString("en-CA", {timeZone:"Asia/Kolkata"});
    if (tournamentDate !== todayIST) return alert("The QR can only be changed on the tournament date.");

    const { error } = await client
        .from("tournaments")
        .update({ scanner_url: null })
        .eq("id", tournamentId)
        .eq("created_by", user.id);

    if (error) return alert("Could not remove QR: " + error.message);
    await loadTournaments("all");
}

const IR_TOURN_STATES = ['Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat','Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh','Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab','Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh','Uttarakhand','West Bengal','Delhi','Jammu and Kashmir','Ladakh','Puducherry','Chandigarh'];
const IR_TOURN_CITIES = {
 'Karnataka':['KR Puram','Avalahalli','Hoskote','Whitefield','Marathahalli','Kadugodi','Mahadevapura','Banaswadi','Indiranagar','Yelahanka','Majestic','Bengaluru','Mysuru','Mangaluru','Hubballi','Belagavi'],
 'Tamil Nadu':['Chennai','Coimbatore','Madurai','Salem','Tiruchirappalli','Tirunelveli'],
 'Telangana':['Hyderabad','Warangal','Karimnagar','Nizamabad'],
 'Andhra Pradesh':['Visakhapatnam','Vijayawada','Guntur','Tirupati','Nellore'],
 'Maharashtra':['Mumbai','Pune','Nagpur','Nashik','Thane'],
 'Kerala':['Kochi','Thiruvananthapuram','Kozhikode','Thrissur'],
 'Delhi':['New Delhi','Dwarka','Rohini','Saket']
};
let irTournamentGeoState='Karnataka', irTournamentGeoScope='state', irTournamentGeoCities=[];
function renderTournamentGeoPicker(){
 const states=document.getElementById('tournStateButtons'), cities=document.getElementById('tournCityButtons');
 if(!states||!cities)return;
 states.innerHTML=IR_TOURN_STATES.map(st=>`<button type="button" class="tourn-geo-chip ${st===irTournamentGeoState?'active':''}" onclick="selectTournamentState(${JSON.stringify(st)})">${st=== 'Karnataka'?'📍 ':''}${st}</button>`).join('');
 const list=IR_TOURN_CITIES[irTournamentGeoState]||[];
 cities.innerHTML=list.map(city=>`<button type="button" class="tourn-geo-chip ${irTournamentGeoCities.includes(city)?'active':''}" onclick="toggleTournamentCity(${JSON.stringify(city)})">${irTournamentGeoCities.includes(city)?'✓ ':''}${city}</button>`).join('');
 const label=document.getElementById('tournSelectedCitiesLabel'); if(label)label.textContent=irTournamentGeoCities.length?`Selected: ${irTournamentGeoCities.join(', ')}`:'No areas selected';
}
function selectTournamentState(state){irTournamentGeoState=state;irTournamentGeoCities=[];renderTournamentGeoPicker();}
function setTournamentGeoScope(scope){irTournamentGeoScope=scope==='cities'?'cities':'state';const stateBtn=document.getElementById('tournScopeStateBtn'),cityBtn=document.getElementById('tournScopeCityBtn'),picker=document.getElementById('tournCityPicker');if(stateBtn)stateBtn.classList.toggle('active',irTournamentGeoScope==='state');if(cityBtn)cityBtn.classList.toggle('active',irTournamentGeoScope==='cities');if(picker)picker.style.display=irTournamentGeoScope==='cities'?'block':'none';}
function toggleTournamentCity(city){const i=irTournamentGeoCities.findIndex(x=>x.toLowerCase()===city.toLowerCase());if(i>=0)irTournamentGeoCities.splice(i,1);else irTournamentGeoCities.push(city);renderTournamentGeoPicker();}
function addTournamentCity(){const input=document.getElementById('tournCustomCity');const city=(input?.value||'').trim();if(!city)return;if(!irTournamentGeoCities.some(x=>x.toLowerCase()===city.toLowerCase()))irTournamentGeoCities.push(city);if(input)input.value='';renderTournamentGeoPicker();}
function resetTournamentGeoPicker(){irTournamentGeoState='Karnataka';irTournamentGeoScope='state';irTournamentGeoCities=[];renderTournamentGeoPicker();setTournamentGeoScope('state');}

function showCreateTournament() {
    resetTournamentGeoPicker();
    const geoBox=document.getElementById('localTournamentGeoBox');
    if(geoBox) geoBox.style.display=(typeof normalizeBattlefield==='function' ? normalizeBattlefield(currentBattlefield||'local') : (currentBattlefield||'local'))==='local'?'block':'none';
    document.getElementById("createTournamentModal").style.display = "flex";
}

function closeCreateTournament() {
    document.getElementById("createTournamentModal").style.display = "none";
    document.getElementById("tournMessage").textContent = "";
}

async function createTournament() {
    const title = document.getElementById("tournTitle").value.trim();
    const tournamentMode = document.getElementById("tournMode")?.value === "squad" ? "squad" : "solo";
    const tournamentFormat = document.getElementById("tournFormat")?.value === "table" ? "table" : "normal";
    const category = document.getElementById("tournCategory").value;
    const game = document.getElementById("tournGame").value.trim();
    const description = document.getElementById("tournDescription").value.trim();
    const maxPlayers = parseInt(document.getElementById("tournMaxPlayers").value);
    const startDate = document.getElementById("tournStart").value;
    const endDate = document.getElementById("tournEnd").value;
    const prize = document.getElementById("tournPrize").value.trim();
    const rules = document.getElementById("tournRules").value.trim();
    const locationState = irTournamentGeoState || 'Karnataka';
    const locationScope = irTournamentGeoScope || 'state';
    const locationCities = locationScope === 'cities' ? [...irTournamentGeoCities] : [];
    const msg = document.getElementById("tournMessage");
    
    if (!title || !game || !startDate || !endDate) {
        msg.textContent = "Please fill in all required fields.";
        msg.style.color = "#ff6b6b";
        return;
    }
    
    if (normalizeBattlefield(currentBattlefield || 'local') === 'local' && locationScope === 'cities' && locationCities.length === 0) {
        msg.textContent = "Choose at least one city/area, or select Entire state.";
        msg.style.color = "#ff6b6b";
        return;
    }
    if (new Date(endDate) <= new Date(startDate)) {
        msg.textContent = "End time must be after start time.";
        msg.style.color = "#ff6b6b";
        return;
    }
    
    const { data: { user } } = await client.auth.getUser();
    if (!user) {
        msg.textContent = "Please login first.";
        msg.style.color = "#ff6b6b";
        return;
    }
    const { data: creatorProfile, error: creatorProfileError } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
    const creatorRole = String(creatorProfile?.role || "").toLowerCase().replace(/[\s-]/g, "_");
    if (creatorProfileError || !["super_admin", "college_admin"].includes(creatorRole)) {
        msg.textContent = "Only an authorized tournament creator/admin can create tournaments.";
        msg.style.color = "#ff6b6b";
        return;
    }
    
    msg.textContent = "Creating tournament...";
    msg.style.color = "#888";
    
    let tournamentScope = { communityId: null, collegeId: null };
    try { tournamentScope = await getBattlefieldMemberIds(normalizeBattlefield(currentBattlefield || 'local'), user.id); } catch (e) { console.warn("Tournament community scope:", e); }
    const tournamentPayload = {
        title,
        description: description || null,
        category,
        game,
        max_players: maxPlayers,
        start_date: startDate,
        end_date: endDate,
        status: new Date(startDate) > new Date() ? 'upcoming' : 'ongoing',
        prize: prize || null,
        rules: rules || null,
        tournament_mode: tournamentMode,
        tournament_format: tournamentFormat,
        location_state: normalizeBattlefield(currentBattlefield || 'local') === 'local' ? locationState : null,
        location_scope: normalizeBattlefield(currentBattlefield || 'local') === 'local' ? locationScope : null,
        location_cities: normalizeBattlefield(currentBattlefield || 'local') === 'local' ? locationCities : [],
        battlefield: (typeof normalizeBattlefield==='function' ? normalizeBattlefield(currentBattlefield||'local') : (currentBattlefield||'local')),
        community_id: tournamentScope.communityId || null,
        college_id: tournamentScope.collegeId || null,
        created_by: user.id
    };
    const { data: tournament, error } = await client.from("tournaments").insert(tournamentPayload).select("id").single();
    
    if (error) {
        msg.textContent = "Error: " + error.message;
        msg.style.color = "#ff6b6b";
        return;
    }
    
    msg.textContent = "✅ Tournament created successfully!";
    msg.style.color = "#00b894";
    
    await sendNotificationToAll(
        "🏆 New Tournament!",
        `A new tournament "${title}" has been created in ${category}! Join now!`,
        "tournament",
        "/tournaments"
    );
    
    setTimeout(() => {
        closeCreateTournament();
        loadTournaments('all');
    }, 1500);
}

let tournamentRegistrationId = null;
let tournamentRegistrationInviteId = null;
let tournamentRegistrationInvite = null;
let tournamentRegistrationTournamentMode = 'solo';

async function openTournamentRegistration(tournamentId, inviteId = null) {
    tournamentRegistrationId = tournamentId;
    tournamentRegistrationInviteId = inviteId;
    tournamentRegistrationInvite = null;
    const modal = document.getElementById('tournamentRegistrationModal');
    if (!modal) return;
    document.getElementById('tournamentRegistrationMessage').textContent = '';
    document.getElementById('tournamentFullName').value = '';
    document.getElementById('tournamentGameUid').value = '';
    document.getElementById('tournamentPhone').value = '';
    document.getElementById('tournamentSquadName').value = '';
    document.getElementById('tournamentSquadInviteArea').style.display = 'none';
    document.getElementById('tournamentSquadInviteMessage').textContent = '';
    modal.style.display = 'flex';
    await loadTournamentRegistrationProfile(tournamentId, inviteId);
}

function closeTournamentRegistration() {
    tournamentRegistrationId = null;
    tournamentRegistrationInviteId = null;
    tournamentRegistrationInvite = null;
    const modal = document.getElementById('tournamentRegistrationModal');
    if (modal) modal.style.display = 'none';
}

async function generateTournamentTableIfDue(tournament){
    if(!tournament || tournament.tournament_format !== 'table' || !tournament.start_date || !tournament.id) return;
    const start = new Date(tournament.start_date).getTime();
    const now = Date.now();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    if(now < start-threeDays || now >= start) return;
    // Do not silently build a partial draw while registrations may still be changing.
    const { data: existing } = await client.from('tournament_matches').select('id').eq('tournament_id',tournament.id).limit(1);
    if(existing && existing.length) return;
    const { data: participants, error } = await client.from('tournament_participants').select('user_id,squad_name,squad_captain_id,is_squad_captain').eq('tournament_id',tournament.id);
    if(error || !participants || participants.length < 2) return;
    const entrants = tournament.tournament_mode === 'squad'
      ? participants.filter(x => x.is_squad_captain || x.squad_captain_id === x.user_id)
      : participants;
    if(entrants.length < 2) return;
    // Shuffle entrants to create a fair random first-round draw.
    for(let i=entrants.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [entrants[i],entrants[j]]=[entrants[j],entrants[i]]; }
    const rows=[];
    for(let i=0;i<entrants.length;i+=2){
      rows.push({tournament_id:tournament.id,round_number:1,match_number:Math.floor(i/2)+1,participant_a_id:entrants[i].user_id,participant_b_id:entrants[i+1]?.user_id||null,status:entrants[i+1]?'scheduled':'bye',scheduled_at:tournament.start_date});
    }
    const { error: insertError } = await client.from('tournament_matches').insert(rows);
    if(insertError) console.error('Tournament table draw:',insertError.message);
}

async function loadTournamentRegistrationProfile(tournamentId, inviteId = null) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const msg = document.getElementById('tournamentRegistrationMessage');
    const { data: tournament, error: tournamentError } = await client.from('tournaments')
        .select('id,title,tournament_mode,status').eq('id', tournamentId).maybeSingle();
    if (tournamentError || !tournament) { msg.textContent = 'Could not load tournament details.'; msg.style.color = '#ff6b6b'; return; }
    tournamentRegistrationTournamentMode = tournament.tournament_mode === 'squad' ? 'squad' : 'solo';
    document.getElementById('tournamentSquadNameWrap').style.display = tournamentRegistrationTournamentMode === 'squad' ? 'block' : 'none';
    document.getElementById('tournamentSquadName').readOnly = false;
    document.getElementById('tournamentSquadHelp').textContent = 'Register as captain, then invite teammates from Inter Rivalry.';

    const { data: profile } = await client.from('profiles').select('full_name').eq('id', user.id).maybeSingle();
    if (profile?.full_name) document.getElementById('tournamentFullName').value = profile.full_name;
    const { data: existing, error: existingError } = await client.from('tournament_participants')
        .select('id,full_name,phone_number,game_id,squad_name,squad_captain_id,is_squad_captain')
        .eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle();
    if (existingError) { msg.textContent = 'Could not load your registration: ' + existingError.message; msg.style.color = '#ff6b6b'; return; }
    if (existing) {
        document.getElementById('tournamentFullName').value = existing.full_name || profile?.full_name || '';
        document.getElementById('tournamentPhone').value = existing.phone_number || '';
        document.getElementById('tournamentGameUid').value = existing.game_id || '';
        document.getElementById('tournamentSquadName').value = existing.squad_name || '';
    }
    if (inviteId) {
        const { data: invite, error: inviteError } = await client.from('tournament_squad_invites')
            .select('id,tournament_id,squad_name,captain_id,invitee_id,status')
            .eq('id', inviteId).eq('invitee_id', user.id).eq('status', 'pending').maybeSingle();
        if (inviteError || !invite || invite.tournament_id !== tournamentId) { msg.textContent = 'This squad invite is no longer available.'; msg.style.color = '#ff6b6b'; return; }
        tournamentRegistrationInvite = invite;
        document.getElementById('tournamentSquadName').value = invite.squad_name || '';
        document.getElementById('tournamentSquadName').readOnly = true;
        document.getElementById('tournamentSquadHelp').textContent = 'You are accepting an invite. Your squad name is locked to the captain’s squad.';
    } else if (tournamentRegistrationTournamentMode === 'squad' && existing?.is_squad_captain) {
        document.getElementById('tournamentSquadInviteArea').style.display = 'block';
        document.getElementById('tournamentSquadInviteMessage').textContent = 'You can invite teammates here, or use TEAM INVITES from the tournament dashboard any time before the tournament finishes.';
        await loadTournamentSquadInviteOptions(tournamentId);
    }
}

async function loadTournamentSquadInviteOptions(tournamentId) {
    const select = document.getElementById('tournamentSquadInvitePlayer');
    if (!select) return;
    select.innerHTML = '<option value="">Loading players...</option>';
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    const { data: participants } = await client.from('tournament_participants').select('user_id').eq('tournament_id', tournamentId);
    const occupied = new Set((participants || []).map(p => p.user_id));
    const { data: pendingInvites } = await client.from('tournament_squad_invites')
        .select('invitee_id').eq('tournament_id', tournamentId).eq('captain_id', user.id).eq('status', 'pending');
    (pendingInvites || []).forEach(i => occupied.add(i.invitee_id));
    const { data: profiles, error } = await client.from('profiles').select('id,full_name,inter_rivalry_id,role')
        .order('full_name', {ascending:true});
    if (error) { select.innerHTML = '<option value="">Could not load players</option>'; document.getElementById('tournamentSquadInviteMessage').textContent = error.message; return; }
    const eligible = (profiles || []).filter(p => String(p.role || 'student').toLowerCase() === 'student' && p.id !== user.id && !occupied.has(p.id));
    select.innerHTML = '<option value="">Select an Inter Rivalry player...</option>' + eligible.map(p => `<option value="${p.id}">${escapeHTML(p.full_name || 'Student')} (${escapeHTML(p.inter_rivalry_id || '-')})</option>`).join('');
    if (!eligible.length) select.innerHTML = '<option value="">No available players to invite</option>';
}

async function sendTournamentSquadInvite() {
    const tournamentId = tournamentRegistrationId;
    const inviteeId = document.getElementById('tournamentSquadInvitePlayer')?.value;
    const msg = document.getElementById('tournamentSquadInviteMessage');
    if (!tournamentId || !inviteeId) { if (msg) msg.textContent = 'Select a player first.'; return; }
    const { data: { user } } = await client.auth.getUser();
    if (!user) { if (msg) msg.textContent = 'Please login first.'; return; }
    const { data: tournament } = await client.from('tournaments').select('id,tournament_mode,status').eq('id', tournamentId).maybeSingle();
    if (!tournament || tournament.tournament_mode !== 'squad') { if (msg) msg.textContent = 'Squad invites are only available for squad tournaments.'; return; }
    const { data: captainReg } = await client.from('tournament_participants').select('id,squad_name,is_squad_captain')
        .eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle();
    if (!captainReg?.is_squad_captain || !captainReg.squad_name) { if (msg) msg.textContent = 'Register your squad name first.'; return; }
    const { error } = await client.from('tournament_squad_invites').insert({tournament_id:tournamentId,squad_name:captainReg.squad_name,captain_id:user.id,invitee_id:inviteeId,status:'pending'});
    if (error) { if (msg) msg.textContent = 'Could not send invite: ' + error.message; return; }
    if (msg) { msg.textContent = '✅ Invite sent inside Inter Rivalry!'; msg.style.color = '#00b894'; }
    await loadTournamentSquadInviteOptions(tournamentId);
}

async function submitTournamentRegistration() {
    const tournamentId = tournamentRegistrationId;
    if (!tournamentId) return;
    const fullName = document.getElementById('tournamentFullName').value.trim();
    const gameUid = document.getElementById('tournamentGameUid').value.trim();
    const phoneNumber = document.getElementById('tournamentPhone').value.trim();
    const squadName = document.getElementById('tournamentSquadName').value.trim();
    const msg = document.getElementById('tournamentRegistrationMessage');
    if (!fullName || !gameUid || !phoneNumber) { msg.textContent = 'Please fill in Name, Game UID and Phone Number.'; msg.style.color = '#ff6b6b'; return; }
    if (tournamentRegistrationTournamentMode === 'squad' && !squadName) { msg.textContent = 'Please enter a squad name.'; msg.style.color = '#ff6b6b'; return; }
    if (!/^[0-9+()\-\s]{7,20}$/.test(phoneNumber)) { msg.textContent = 'Please enter a valid phone number.'; msg.style.color = '#ff6b6b'; return; }
    const { data: { user } } = await client.auth.getUser();
    if (!user) { msg.textContent = 'Please login first.'; msg.style.color = '#ff6b6b'; return; }
    msg.textContent = 'Registering...'; msg.style.color = '#aaa';
    const { data: tournament, error: tournamentError } = await client.from('tournaments')
        .select('id,title,max_players,status,tournament_mode,battlefield,location_state,location_scope,location_cities').eq('id', tournamentId).maybeSingle();
    if (tournamentError || !tournament) { msg.textContent = 'Could not find this tournament.'; msg.style.color = '#ff6b6b'; return; }
    if (tournament.status === 'completed') { msg.textContent = 'Registration is closed for this tournament.'; msg.style.color = '#ff6b6b'; return; }
    if ((tournament.battlefield || 'local') === 'local' && tournament.location_state) {
        const {data: geoProfile, error: geoErr} = await client.from('profiles').select('local_state,local_city,local_area').eq('id',user.id).maybeSingle();
        if (geoErr) {
            console.error('Tournament Local Profile location lookup failed:', geoErr);
            msg.textContent = 'Could not read your Local Profile location. Please run the V7.2 Local Tournament Location SQL in Supabase, then save your Local Profile location again. Details: ' + geoErr.message;
            msg.style.color = '#ff6b6b'; return;
        }
        const userState=String(geoProfile?.local_state||'').trim().toLowerCase();
        const targetState=String(tournament.location_state||'').trim().toLowerCase();
        if (!userState || userState !== targetState) { msg.textContent = `This tournament is for ${tournament.location_state}. Update your Local Profile state to register.`; msg.style.color = '#ff6b6b'; return; }
        if (tournament.location_scope === 'cities') {
            const userLocations=[geoProfile?.local_city,geoProfile?.local_area].filter(Boolean).map(x=>String(x).trim().toLowerCase());
            const allowed=(tournament.location_cities||[]).map(x=>String(x).trim().toLowerCase());
            if (!userLocations.some(loc=>allowed.includes(loc))) { msg.textContent = `This tournament is limited to: ${allowed.join(', ')}. Your Local Profile city/area must match.`; msg.style.color = '#ff6b6b'; return; }
        }
    }
    const mode = tournament.tournament_mode === 'squad' ? 'squad' : 'solo';
    if (mode !== tournamentRegistrationTournamentMode) { msg.textContent = 'Tournament mode changed. Close and reopen registration.'; msg.style.color = '#ff6b6b'; return; }
    let captainId = null, isCaptain = false;
    if (tournamentRegistrationInviteId) {
        const inv = tournamentRegistrationInvite;
        if (!inv || inv.invitee_id !== user.id || inv.status !== 'pending') { msg.textContent = 'This invite is no longer valid.'; msg.style.color = '#ff6b6b'; return; }
        captainId = inv.captain_id;
    } else if (mode === 'squad') { captainId = user.id; isCaptain = true; }
    const { count } = await client.from('tournament_participants').select('id', {count:'exact',head:true}).eq('tournament_id', tournamentId);
    const { data: existing } = await client.from('tournament_participants').select('id').eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle();
    if (!existing && (count || 0) >= Number(tournament.max_players || 0)) { msg.textContent = 'This tournament is already full.'; msg.style.color = '#ff6b6b'; return; }
    const payload = {tournament_id:tournamentId,user_id:user.id,full_name:fullName,phone_number:phoneNumber,game_id:gameUid,registered_at:new Date().toISOString(),squad_name:mode==='squad'?squadName:null,squad_captain_id:mode==='squad'?captainId:null,is_squad_captain:mode==='squad'?isCaptain:false};
    const result = existing ? await client.from('tournament_participants').update(payload).eq('id',existing.id) : await client.from('tournament_participants').insert(payload);
    if (result.error) { msg.textContent = 'Could not register: ' + result.error.message; msg.style.color = '#ff6b6b'; return; }
    if (tournamentRegistrationInviteId) {
        const { error: inviteUpdateError } = await client.from('tournament_squad_invites').update({status:'accepted'}).eq('id',tournamentRegistrationInviteId).eq('invitee_id',user.id).eq('status','pending');
        if (inviteUpdateError) { msg.textContent = 'Registration saved, but invite status could not update: ' + inviteUpdateError.message; msg.style.color = '#ffcb6b'; return; }
    }
    msg.textContent = mode==='squad' ? (isCaptain?'✅ Squad registered! Invite teammates below.':'✅ You joined the squad!') : '✅ Registration saved successfully!';
    msg.style.color = '#00b894';
    if (mode==='squad' && isCaptain && !tournamentRegistrationInviteId) {
        document.getElementById('tournamentSquadInviteArea').style.display='block';
        await loadTournamentSquadInviteOptions(tournamentId);
        await loadTournaments('all');
        return;
    }
    setTimeout(()=>{closeTournamentRegistration();loadTournaments('all');},900);
}

async function openTournamentSquadInvites() {
    const modal=document.getElementById('tournamentSquadInvitesModal');
    const content=document.getElementById('tournamentSquadInvitesContent');
    if(!modal||!content)return;
    modal.style.display='flex'; content.innerHTML='<div class="empty-box">Loading invites...</div>';
    await loadTournamentSquadInvites();
}
function closeTournamentSquadInvites(){const modal=document.getElementById('tournamentSquadInvitesModal');if(modal)modal.style.display='none';}
async function loadTournamentSquadInvites(){
    const content=document.getElementById('tournamentSquadInvitesContent');if(!content)return;
    const {data:{user}}=await client.auth.getUser();if(!user){content.innerHTML='<div class="empty-box">Please login first.</div>';return;}
    const {data:invites,error}=await client.from('tournament_squad_invites').select('id,tournament_id,squad_name,captain_id,created_at,status').eq('invitee_id',user.id).eq('status','pending').order('created_at',{ascending:false});
    const badge=document.getElementById('tournamentSquadInviteBadge');if(badge)badge.textContent=invites?.length?`(${invites.length})`:'';
    if(error){content.innerHTML=`<div class="empty-box">Could not load invites: ${escapeHTML(error.message)}</div>`;return;}
    if(!invites?.length){content.innerHTML='<div class="empty-box">No pending tournament squad invites.</div>';return;}
    const cards=[];
    for(const inv of invites){
        const [{data:tournament},{data:captain}]=await Promise.all([client.from('tournaments').select('title,game').eq('id',inv.tournament_id).maybeSingle(),client.from('profiles').select('full_name,inter_rivalry_id').eq('id',inv.captain_id).maybeSingle()]);
        cards.push(`<div class="invite-card"><h4>👥 ${escapeHTML(inv.squad_name||'Squad')}</h4><div class="invite-info"><strong>Tournament:</strong> ${escapeHTML(tournament?.title||'Tournament')}<br><strong>Game:</strong> ${escapeHTML(tournament?.game||'-')}<br><strong>Captain:</strong> ${escapeHTML(captain?.full_name||'Player')} (${escapeHTML(captain?.inter_rivalry_id||'-')})<br><strong>Sent:</strong> ${formatDate(inv.created_at)}</div><div class="invite-actions"><button class="btn-3d-sm-white-glow" onclick="acceptTournamentSquadInvite('${inv.id}')">✅ ACCEPT</button><button class="btn-3d-sm-white-glow-danger" onclick="declineTournamentSquadInvite('${inv.id}')">❌ DECLINE</button></div></div>`);
    }
    content.innerHTML=cards.join('');
}
async function acceptTournamentSquadInvite(inviteId){
    const {data:{user}}=await client.auth.getUser();if(!user)return alert('Please login first.');
    const {data:invite,error}=await client.from('tournament_squad_invites').select('id,tournament_id,invitee_id,status').eq('id',inviteId).eq('invitee_id',user.id).eq('status','pending').maybeSingle();
    if(error||!invite)return alert('This invite is no longer available.');
    closeTournamentSquadInvites();await openTournamentRegistration(invite.tournament_id,invite.id);
}
async function declineTournamentSquadInvite(inviteId){
    const {data:{user}}=await client.auth.getUser();if(!user)return alert('Please login first.');
    const {error}=await client.from('tournament_squad_invites').update({status:'declined'}).eq('id',inviteId).eq('invitee_id',user.id).eq('status','pending');
    if(error)return alert('Could not decline invite: '+error.message);await loadTournamentSquadInvites();
}

async function openTournamentParticipants(tournamentId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return alert('Please login first.');

    const { data: tournament, error: tournamentError } = await client
        .from('tournaments')
        .select('id,title,created_by,max_players,tournament_mode')
        .eq('id', tournamentId)
        .maybeSingle();

    if (tournamentError || !tournament) {
        alert('Could not load tournament.');
        return;
    }

    if (tournament.created_by !== user.id) {
        alert('Only the tournament creator can view participants.');
        return;
    }

    const modal = document.getElementById('tournamentParticipantsModal');
    const content = document.getElementById('tournamentParticipantsContent');
    document.getElementById('tournamentParticipantsTitle').textContent = '👥 ' + (tournament.title || 'Tournament') + ' — Participants';
    content.innerHTML = '<div class="empty-box">Loading participants...</div>';
    modal.style.display = 'flex';

    const { data, error } = await client
        .from('tournament_participants')
        .select('id,full_name,phone_number,game_id,registered_at,user_id,squad_name,squad_captain_id,is_squad_captain')
        .eq('tournament_id', tournamentId)
        .order('registered_at', { ascending: true });

    if (error) {
        content.innerHTML = `<div class="empty-box">Could not load participants: ${escapeHTML(error.message)}</div>`;
        return;
    }

    if (!data?.length) {
        content.innerHTML = '<div class="empty-box">No participants have registered yet.</div>';
        return;
    }
    const participantIds=[...new Set(data.map(p=>p.user_id).filter(Boolean))];
    let participantProfiles={};
    if(participantIds.length){
        const {data:profiles,error:profilesError}=await client.from('profiles').select('id,full_name,inter_rivalry_id').in('id',participantIds);
        if(profilesError) console.warn('Could not load tournament participant IR IDs:',profilesError.message);
        else participantProfiles=Object.fromEntries((profiles||[]).map(p=>[p.id,p]));
    }

    content.innerHTML = `
        <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;min-width:650px;">
                <thead>
                    <tr style="border-bottom:1px solid #333;">
                        <th style="padding:10px;text-align:left;color:#aaa;">#</th>
                        <th style="padding:10px;text-align:left;color:#aaa;">NAME</th>
                        <th style="padding:10px;text-align:left;color:#aaa;">IR ID</th>
                        ${tournament.tournament_mode === 'squad' ? '<th style="padding:10px;text-align:left;color:#aaa;">TEAM NAME</th><th style="padding:10px;text-align:left;color:#aaa;">ROLE</th>' : ''}
                        <th style="padding:10px;text-align:left;color:#aaa;">GAME UID</th>
                        <th style="padding:10px;text-align:left;color:#aaa;">${tournament.tournament_mode === 'squad' ? 'CAPTAIN PHONE' : 'PHONE'}</th>
                        <th style="padding:10px;text-align:left;color:#aaa;">REGISTERED</th>
                    </tr>
                </thead>
                <tbody>
                    ${data.map((p, i) => `
                        <tr style="border-bottom:1px solid #222;">
                            <td style="padding:10px;color:#777;">${i + 1}</td>
                            <td style="padding:10px;color:white;font-weight:700;">${escapeHTML(p.full_name || participantProfiles[p.user_id]?.full_name || '-')}</td>
                            <td style="padding:10px;color:#d6b65c;font-weight:700;">${escapeHTML(participantProfiles[p.user_id]?.inter_rivalry_id || '-')}</td>
                            ${tournament.tournament_mode === 'squad' ? `<td style="padding:10px;color:#00d2ff;">${escapeHTML(p.squad_name || '-')}</td><td style="padding:10px;color:#aaa;">${p.is_squad_captain ? '👑 Captain' : 'Member'}</td>` : ''}
                            <td style="padding:10px;color:#00d2ff;font-weight:700;">${escapeHTML(p.game_id || '-')}</td>
                            <td style="padding:10px;color:#ddd;">${escapeHTML((tournament.tournament_mode === 'squad' && !p.is_squad_captain) ? '—' : (p.phone_number || '-'))}</td>
                            <td style="padding:10px;color:#888;font-size:12px;">${p.registered_at ? escapeHTML(new Date(p.registered_at).toLocaleString()) : '-'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div style="margin-top:12px;color:#777;font-size:12px;">${data.length}/${tournament.max_players || '?'} registered. Contact details are visible only in the creator's participant dashboard.</div>
    `;
}

function closeTournamentParticipants() {
    const modal = document.getElementById('tournamentParticipantsModal');
    if (modal) modal.style.display = 'none';
}


async function deleteTournament(tournamentId) {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return alert("Please login first.");

    const { data: tournament, error: loadError } = await client
        .from("tournaments")
        .select("id,title,created_by")
        .eq("id", tournamentId)
        .maybeSingle();

    if (loadError || !tournament) {
        return alert("Could not find this tournament.");
    }

    if (tournament.created_by !== user.id) {
        return alert("Only the tournament creator can delete this tournament.");
    }

    const confirmed = confirm(
        `Delete \"${tournament.title || 'this tournament'}\" permanently?\n\nAll registrations for this tournament will also be deleted.`
    );
    if (!confirmed) return;

    // Remove uploaded QR/room images first so they do not become orphaned.
    try {
        const { data: objects, error: listError } = await client
            .storage
            .from("tournament-scanners")
            .list(tournamentId, { limit: 1000 });

        if (!listError && objects?.length) {
            const paths = objects
                .filter(obj => obj?.name)
                .map(obj => `${tournamentId}/${obj.name}`);
            if (paths.length) {
                await client.storage.from("tournament-scanners").remove(paths);
            }
        }
    } catch (storageError) {
        console.warn("Tournament QR cleanup failed:", storageError?.message || storageError);
    }

    // Delete registrations first.
    const { error: participantError } = await client
        .from("tournament_participants")
        .delete()
        .eq("tournament_id", tournamentId);

    if (participantError) {
        return alert("Could not delete tournament registrations: " + participantError.message);
    }

    // Delete the tournament itself. RLS also verifies creator ownership.
    const { error: deleteError } = await client
        .from("tournaments")
        .delete()
        .eq("id", tournamentId);

    if (deleteError) {
        return alert("Could not delete tournament: " + deleteError.message);
    }

    alert("✅ Tournament deleted successfully.");
    await loadTournaments("all");
}

async function leaveTournament(tournamentId) {
    if (!confirm("Are you sure you want to leave this tournament?")) return;
    
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    
    const { error } = await client.from("tournament_participants")
        .delete()
        .eq("tournament_id", tournamentId)
        .eq("user_id", user.id);
    
    if (error) {
        alert("Could not leave: " + error.message);
        return;
    }
    
    alert("You left the tournament.");
    loadTournaments(document.querySelector('#tournamentsPage .filter-btn[style*="opacity: 1"]')?.id?.replace('tournFilter', '').toLowerCase() || 'all');
}

// ==================== NOTIFICATION FUNCTIONS ====================
async function sendNotificationToAll(title, message, type = 'info', link = null) {
    const { data: profiles } = await client.from("profiles").select("id").eq("role", "student");
    if (!profiles || profiles.length === 0) return;
    
    const notifications = profiles.map(p => ({
        user_id: p.id,
        title: title,
        message: message,
        notification_type: type,
        data: link ? { link } : {},
        is_read: false
    }));
    
    const { data: admins } = await client.from("profiles").select("id").in("role", ['super_admin', 'college_admin']);
    if (admins && admins.length > 0) {
        admins.forEach(a => {
            notifications.push({
                user_id: a.id,
                title: title,
                message: message,
                notification_type: type,
                data: link ? { link } : {},
                is_read: false
            });
        });
    }
    
    const batchSize = 50;
    for (let i = 0; i < notifications.length; i += batchSize) {
        const batch = notifications.slice(i, i + batchSize);
        await client.from("notifications").insert(batch);
    }
}

async function loadNotifications() {
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    
    const { data, error } = await client
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20);
    
    if (error) return;
    
    const unreadCount = (data || []).filter(n => !n.is_read).length;
    const badge = document.getElementById("notificationBadge");
    if (badge) {
        badge.textContent = unreadCount;
        badge.style.display = unreadCount > 0 ? 'flex' : 'none';
    }
}

async function loadNotificationList() {
    const dropdown = document.getElementById("notificationDropdown");
    if (!dropdown) return;
    
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    
    const { data, error } = await client
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10);
    
    if (error || !data || data.length === 0) {
        dropdown.innerHTML = "<div style='color:#888;padding:10px;text-align:center;'>No notifications</div>";
        return;
    }
    
    dropdown.innerHTML = data.map(n => `
        <div style="padding:10px;border-bottom:1px solid #222;cursor:pointer;${n.is_read ? 'opacity:0.6;' : ''}" onclick="markNotificationRead('${n.id}')">
            <div style="font-weight:700;font-size:14px;">${escapeHTML(n.title)}</div>
            <div style="font-size:12px;color:#888;">${escapeHTML(n.message)}</div>
            <div style="font-size:10px;color:#555;margin-top:4px;">${formatDate(n.created_at)}</div>
        </div>
    `).join('');
}

async function markNotificationRead(notificationId) {
    await client.from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);
    loadNotifications();
    loadNotificationList();
}

function toggleNotifications() {
    const dropdown = document.getElementById("notificationDropdown");
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'none' ? 'block' : 'none';
        if (dropdown.style.display === 'block') {
            loadNotificationList();
        }
    }
}

// Restore push button state when the dashboard is available.
document.addEventListener('DOMContentLoaded', restorePushNotificationState);

// ==================== STUDENTS CATEGORY FILTER (ADMIN) ====================
async function loadStudents(){
    const display = document.getElementById("studentsDisplay");
    if(!display) return;
    display.innerHTML = "<div class='empty-box'>Loading students...</div>";
    
    const { data, error } = await client.from("college_memberships")
        .select(`id,user_id,student_number,department,course,year_of_study,specialization,joined_at,profiles!college_memberships_user_id_fkey(full_name,inter_rivalry_id)`)
        .eq("college_id", selectedCollegeId)
        .eq("is_active", true)
        .order("year_of_study", { ascending: true });
    
    if(error || !data || data.length === 0){
        display.innerHTML = "<div class='empty-box'>No students in this college.</div>";
        return;
    }
    
    allStudentsData = data;
    displayStudentsByCategory('all');
}

function displayStudentsByCategory(category){
    const display = document.getElementById("studentsDisplay");
    const data = allStudentsData || [];
    
    if(!data.length){ display.innerHTML = "<div class='empty-box'>No students found.</div>"; return; }
    
    let filtered = data;
    if(category !== 'all'){ filtered = data.filter(s => s.course === category); }
    
    if(!filtered.length){ display.innerHTML = `<div class='empty-box'>No students found in ${category} category.</div>`; return; }
    
    const grouped = {};
    filtered.forEach(student => {
        const course = student.course || 'Unknown';
        const year = student.year_of_study || 0;
        const yearLabel = year === 1 ? '1st Year' : year === 2 ? '2nd Year' : year === 3 ? '3rd Year' : `${year}th Year`;
        if(!grouped[course]) grouped[course] = {};
        if(!grouped[course][yearLabel]) grouped[course][yearLabel] = [];
        grouped[course][yearLabel].push(student);
    });
    
    let html = '';
    const courseOrder = ['BCA', 'BBA', 'B.COM'];
    const sortedCourses = Object.keys(grouped).sort((a, b) => {
        const indexA = courseOrder.indexOf(a);
        const indexB = courseOrder.indexOf(b);
        if(indexA === -1 && indexB === -1) return a.localeCompare(b);
        if(indexA === -1) return 1;
        if(indexB === -1) return -1;
        return indexA - indexB;
    });
    
    sortedCourses.forEach(course => {
        const years = grouped[course];
        const yearKeys = Object.keys(years).sort((a, b) => { const numA = parseInt(a); const numB = parseInt(b); return numA - numB; });
        let courseColor = '#6c5ce7';
        if(course === 'BCA') courseColor = '#6c5ce7';
        else if(course === 'BBA') courseColor = '#00b894';
        else if(course === 'B.COM') courseColor = '#fdcb6e';
        
        html += `<div style="background:#121212;border:1px solid #292929;border-radius:16px;padding:20px;margin-bottom:16px;">
            <h2 style="color:${courseColor};margin-bottom:15px;display:flex;align-items:center;gap:10px;">
                <span style="font-size:28px;">${course === 'BCA' ? '💻' : course === 'BBA' ? '📊' : '💰'}</span>
                ${escapeHTML(course)}
                <span style="font-size:14px;color:#888;font-weight:400;">(${filtered.filter(s => s.course === course).length} students)</span>
            </h2>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:15px;">`;
        
        yearKeys.forEach(year => {
            const students = years[year];
            html += `<div style="background:#0e0e0e;border:1px solid #282828;border-radius:12px;padding:16px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <h3 style="color:#00d2ff;font-size:16px;">📅 ${escapeHTML(year)}</h3>
                    <span style="background:#1a1a1a;padding:4px 12px;border-radius:999px;font-size:12px;color:#888;">${students.length} students</span>
                </div>
                <div style="display:flex;flex-direction:column;gap:6px;">`;
            
            students.forEach(student => {
                const profile = student.profiles;
                const name = profile?.full_name || 'Unknown';
                const rivalryId = profile?.inter_rivalry_id || 'Not assigned';
                const spec = student.specialization || '';
                html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0a0a0a;border-radius:8px;border-left:3px solid ${courseColor};">
                    <div><span style="font-weight:600;">👤 ${escapeHTML(name)}</span>
                    <br><span style="font-size:11px;color:#666;">ID: ${escapeHTML(rivalryId)}</span>
                    ${spec ? `<br><span style="font-size:11px;color:#888;">🎯 ${escapeHTML(spec)}</span>` : ''}</div>
                    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                        <button class="btn-3d-xs-white-glow" style="width:auto;padding:4px 12px;font-size:10px;" onclick="viewProfile('${student.user_id}')">VIEW</button>
                        <button class="btn-3d-xs-white-glow-danger" style="width:auto;padding:4px 12px;font-size:10px;" onclick="removeStudentFromCollege('${student.id}', '${student.user_id}', '${escapeHTML(name)}')">REMOVE</button>
                    </div>
                </div>`;
            });
            html += `</div></div>`;
        });
        html += `</div></div>`;
    });
    display.innerHTML = html;
    
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.style.opacity = '0.5';
        btn.style.transform = 'scale(0.95)';
    });
    const activeBtn = document.getElementById(`filter${category === 'all' ? 'All' : category}`);
    if(activeBtn) { activeBtn.style.opacity = '1'; activeBtn.style.transform = 'scale(1)'; }
}

async function removeStudentFromCollege(membershipId, userId, studentName){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ alert("Please login first."); return; }

    const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();

    if(profileError || !profile || !["super_admin", "college_admin"].includes(profile.role)){
        alert("Only admins can remove students.");
        return;
    }

    const confirmed = confirm(
        `Remove ${studentName || "this student"} from this college?\n\n` +
        "The student's account and history will NOT be deleted. " +
        "Only the active college membership will be disabled."
    );
    if(!confirmed) return;

    // College admins can only update memberships belonging to their assigned college
    // because the database RLS policy checks the target college_id.
    const { error } = await client
        .from("college_memberships")
        .update({ is_active: false })
        .eq("id", membershipId)
        .eq("user_id", userId);

    if(error){
        console.error(error);
        alert("Could not remove student:\n" + error.message);
        return;
    }

    alert("Student removed from this college successfully. 🎓");
    await loadStudents();
}

function filterStudents(category){
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.style.opacity = '0.5';
        btn.style.transform = 'scale(0.95)';
    });
    const btnId = category === 'all' ? 'filterAll' : `filter${category}`;
    const activeBtn = document.getElementById(btnId);
    if(activeBtn) { activeBtn.style.opacity = '1'; activeBtn.style.transform = 'scale(1)'; }
    displayStudentsByCategory(category);
}

// ==================== TEAM MANAGEMENT ====================
async function loadMyTeams(){
    const list = document.getElementById("myTeamsList");
    if(!list) return;
    list.innerHTML = "<div class='empty-box'>Loading your teams...</div>";

    const { data: { user } } = await client.auth.getUser();
    if(!user){
        list.innerHTML = "<div class='empty-box'>Please login first.</div>";
        return;
    }

    const { data: memberships, error } = await client
        .from("team_members")
        .select(`team_id,teams(id,name,college_id,captain_id,created_at,profiles!teams_captain_id_fkey(full_name,inter_rivalry_id))`)
        .eq("user_id", user.id);

    if(error){
        console.error("LOAD TEAMS ERROR:", error);
        list.innerHTML = `<div class='empty-box'>Unable to load your teams.<br>${escapeHTML(error.message)}</div>`;
        return;
    }

    if(!memberships || memberships.length === 0){
        list.innerHTML = "<div class='empty-box'>You haven't joined any team yet.<br>Create one or wait for an invite!</div>";
        return;
    }

    list.innerHTML = "";
    for(const m of memberships){
        const team = m.teams;
        if(!team) continue;

        const isCaptain = team.captain_id === user.id;
        const { count } = await client
            .from("team_members")
            .select("id", { count:"exact", head:true })
            .eq("team_id", team.id);

        const card = document.createElement("div");
        card.className = "team-card";
        card.innerHTML = `
            <h3>👥 ${escapeHTML(team.name)} ${isCaptain ? '👑' : ''}</h3>
            <div class="team-info">
                <strong>Captain:</strong> ${escapeHTML(team.profiles?.full_name || "Unknown")}<br>
                <strong>Members:</strong> ${count || 0}<br>
                <strong>Your Role:</strong> ${isCaptain ? "captain" : "member"}
            </div>
            <div class="action-row">
                <button class="btn-3d-sm-white-glow" onclick="viewTeamDetails('${team.id}')">📋 MANAGE</button>
                ${!isCaptain ? `<button class="btn-3d-sm-white-glow-danger" onclick="leaveTeam('${team.id}')">🚪 LEAVE</button>` : ''}
            </div>`;
        list.appendChild(card);
    }

    if(!list.children.length){
        list.innerHTML = "<div class='empty-box'>You haven't joined any team yet.<br>Create one or wait for an invite!</div>";
    }
}

async function viewTeamDetails(teamId){
    document.getElementById("teamDetailsPage").classList.remove("hidden");
    document.getElementById("studentDashboard").classList.add("hidden");
    document.getElementById("teamDetailsContent").innerHTML = "<div class='empty-box'>Loading team details...</div>";

    const { data: { user } } = await client.auth.getUser();
    if(!user){
        document.getElementById("teamDetailsContent").innerHTML = "<div class='empty-box'>Please login.</div>";
        return;
    }

    const { data: team, error } = await client
        .from("teams")
        .select(`id,name,college_id,captain_id,created_at,profiles!teams_captain_id_fkey(full_name,inter_rivalry_id)`)
        .eq("id", teamId)
        .single();

    if(error || !team){
        document.getElementById("teamDetailsContent").innerHTML = "<div class='empty-box'>Team not found.</div>";
        return;
    }

    const { data: membership } = await client
        .from("team_members")
        .select("id")
        .eq("team_id", teamId)
        .eq("user_id", user.id)
        .maybeSingle();

    if(!membership){
        document.getElementById("teamDetailsContent").innerHTML = "<div class='empty-box'>You are not a member of this team.</div>";
        return;
    }

    const isCaptain = team.captain_id === user.id;

    const { data: members, error: membersError } = await client
        .from("team_members")
        .select(`user_id,profiles(full_name,inter_rivalry_id)`)
        .eq("team_id", teamId);

    if(membersError){
        document.getElementById("teamDetailsContent").innerHTML = `<div class='empty-box'>Unable to load members.<br>${escapeHTML(membersError.message)}</div>`;
        return;
    }

    const { data: invites } = await client
        .from("team_invites")
        .select(`id,invitee_id,status,created_at,profiles!team_invites_invitee_id_fkey(full_name,inter_rivalry_id)`)
        .eq("team_id", teamId)
        .eq("status", "pending");

    const memberIds = (members || []).map(m => m.user_id);
    let allStudents = [];

    if(isCaptain){
        const { data: students } = await client
            .from("profiles")
            .select("id,full_name,inter_rivalry_id")
            .eq("role", "student")
            .order("full_name", { ascending:true });

        allStudents = (students || []).filter(s => !memberIds.includes(s.id) && s.id !== user.id);
    }

    let html = `
        <div class="profile-card">
            <h2>👥 ${escapeHTML(team.name)}</h2>
            <div class="team-info">
                <strong>Captain:</strong> ${escapeHTML(team.profiles?.full_name || "Unknown")}<br>
                <strong>ID:</strong> ${escapeHTML(team.profiles?.inter_rivalry_id || "-")}<br>
                <strong>Created:</strong> ${formatDate(team.created_at)}<br>
                <strong>Members:</strong> ${members?.length || 0}
            </div>
        </div>`;

    if(isCaptain){
        html += `
            <div class="profile-card">
                <h3>📩 Invite Players</h3>
                <div class="invite-row">
                    <select id="invitePlayerSelect">
                        <option value="">Select a player...</option>
                        ${allStudents.map(s => `<option value="${s.id}">${escapeHTML(s.full_name)} (${escapeHTML(s.inter_rivalry_id || "-")})</option>`).join("")}
                    </select>
                    <button class="btn-3d-sm-white-glow" onclick="sendTeamInvite('${teamId}')">📨 SEND INVITE</button>
                </div>
                <div id="teamInviteMessage" class="message"></div>
            </div>`;
    }

    if(invites && invites.length > 0){
        html += `<h3 style="margin-top:20px">📨 Pending Invites</h3>`;
        html += invites.map(inv => `
            <div class="invite-card">
                <h4>👤 ${escapeHTML(inv.profiles?.full_name || "Unknown")}</h4>
                <div class="invite-info">
                    ID: ${escapeHTML(inv.profiles?.inter_rivalry_id || "-")}<br>
                    Status: <span class="status-pill status-pending">Pending</span>
                </div>
                ${isCaptain ? `<div class="invite-actions"><button class="btn-3d-sm-white-glow-danger" onclick="cancelTeamInvite('${inv.id}')">❌ CANCEL</button></div>` : ''}
            </div>`).join("");
    }

    html += `<h3 style="margin-top:20px">👥 Members</h3>`;
    html += (members || []).map(m => {
        const memberIsCaptain = m.user_id === team.captain_id;
        return `
            <div class="invite-card">
                <h4>${escapeHTML(m.profiles?.full_name || "Unknown")} ${memberIsCaptain ? '👑' : ''}</h4>
                <div class="invite-info">
                    ID: ${escapeHTML(m.profiles?.inter_rivalry_id || "-")}<br>
                    Role: ${memberIsCaptain ? "captain" : "member"}
                </div>
                ${isCaptain && !memberIsCaptain ? `<div class="invite-actions"><button class="btn-3d-sm-white-glow-danger" onclick="removeTeamMember('${teamId}','${m.user_id}')">🗑️ REMOVE</button></div>` : ''}
            </div>`;
    }).join("") || "<div class='empty-box'>No members yet.</div>";

    if(isCaptain){
        html += `<div style="margin-top:20px"><button class="btn-3d-sm-white-glow-danger" onclick="deleteTeam('${teamId}')">🗑️ DELETE TEAM</button></div>`;
    }

    document.getElementById("teamDetailsContent").innerHTML = html;
    document.getElementById("teamDetailsContent").dataset.teamId = teamId;
}

async function createTeam(){
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;padding:20px;backdrop-filter:blur(10px);`;
    const modal = document.createElement('div');
    modal.style.cssText = `background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:40px;max-width:450px;width:100%;`;
    modal.innerHTML = `
        <h2 style="color:white;text-align:center;margin-bottom:10px;">👥 Create Team</h2>
        <p style="color:#888;text-align:center;margin-bottom:25px;">Enter your team name below</p>
        <div style="margin-bottom:20px;"><label style="color:#aaa;display:block;margin-bottom:10px;font-weight:700;">🏷️ Team Name</label>
        <input id="teamNameInput" type="text" placeholder="Type team name..." style="width:100%;padding:14px;background:#0a0a0a;border:1px solid #333;border-radius:10px;color:white;font-size:16px;text-align:center;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
            <button id="confirmTeamBtn" class="btn-3d-white-glow">✅ CREATE</button>
            <button id="cancelTeamBtn" class="btn-3d-sm-white-glow-danger">❌ CANCEL</button>
        </div>
        <div id="teamCreateMessage" style="color:#888;text-align:center;margin-top:12px;"></div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    document.getElementById('cancelTeamBtn').addEventListener('click', () => overlay.remove());

    document.getElementById('confirmTeamBtn').addEventListener('click', async function(){
        const name = document.getElementById('teamNameInput').value.trim();
        const msg = document.getElementById('teamCreateMessage');
        if(!name){ msg.textContent = '⚠️ Please enter a team name'; msg.style.color = '#ff6b6b'; return; }

        this.textContent = '⏳ CREATING...';
        this.disabled = true;

        const { data: { user } } = await client.auth.getUser();
        if(!user){ msg.textContent = 'Please login first'; msg.style.color = '#ff6b6b'; this.textContent = '✅ CREATE'; this.disabled = false; return; }

        const { data: result, error } = await client.rpc("create_team_for_user", { p_name: name });
        if(error){
            console.error("CREATE TEAM ERROR:", error);
            msg.textContent = '❌ ' + error.message;
            msg.style.color = '#ff6b6b';
            this.textContent = '✅ CREATE';
            this.disabled = false;
            return;
        }

        msg.textContent = '✅ Team created! 🎉';
        msg.style.color = '#00b894';
        document.getElementById('teamNameInput').value = '';

        setTimeout(() => {
            overlay.remove();
            backToStudentDashboard();
            loadMyTeams();
        }, 700);
    });

    overlay.addEventListener('click', e => { if(e.target === overlay) overlay.remove(); });
}

async function sendTeamInvite(teamId){
    const select = document.getElementById("invitePlayerSelect");
    const inviteeId = select?.value;
    const msg = document.getElementById("teamInviteMessage");
    if(!inviteeId){ if(msg) msg.textContent = "Select a player."; return; }

    if(msg) msg.textContent = "Sending invite...";

    const { data, error } = await client.rpc("send_team_invite", {
        p_team_id: teamId,
        p_invitee_id: inviteeId
    });

    if(error){
        console.error("SEND TEAM INVITE ERROR:", error);
        if(msg) msg.textContent = "Error: " + error.message;
        return;
    }

    if(msg) msg.textContent = data?.message || "✅ Invite sent!";
    select.value = "";
    setTimeout(() => viewTeamDetails(teamId), 700);
}

async function cancelTeamInvite(inviteId){
    if(!confirm("Cancel this invite?")) return;

    const { error } = await client.rpc("cancel_team_invite", { p_invite_id: inviteId });
    if(error){ alert("Could not cancel invite:\n" + error.message); return; }

    const teamId = document.getElementById("teamDetailsContent")?.dataset?.teamId;
    if(teamId) viewTeamDetails(teamId);
    else loadMyTeams();
}

async function acceptTeamInvite(inviteId){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ alert("Please login first."); return; }

    if(!confirm("Join this team?")) return;

    const { data, error } = await client.rpc("accept_team_invite", { p_invite_id: inviteId });

    if(error){
        console.error("ACCEPT TEAM INVITE ERROR:", error);
        alert("Could not join the team:\n" + error.message);
        await loadTeamInvites();
        await loadMyTeams();
        return;
    }

    alert(data?.message || "✅ You joined the team!");
    await loadTeamInvites();
    await loadMyTeams();
}

async function declineTeamInvite(inviteId){
    if(!confirm("Decline this invite?")) return;

    const { error } = await client.rpc("decline_team_invite", { p_invite_id: inviteId });
    if(error){ alert("Could not decline invite:\n" + error.message); return; }

    await loadTeamInvites();
}

async function loadTeamInvites(){
    const list = document.getElementById("teamInvitesList");
    if(!list) return;
    list.innerHTML = "<div class='empty-box'>Loading invites...</div>";

    const { data: { user } } = await client.auth.getUser();
    if(!user){ list.innerHTML = "<div class='empty-box'>Please login.</div>"; return; }

    const { data: invites, error } = await client
        .from("team_invites")
        .select(`id,team_id,status,created_at,sender_id,profiles!team_invites_sender_id_fkey(full_name,inter_rivalry_id),teams(id,name,captain_id)`)
        .eq("invitee_id", user.id)
        .eq("status", "pending")
        .order("created_at", { ascending:false });

    if(error){
        console.error("LOAD TEAM INVITES ERROR:", error);
        list.innerHTML = `<div class='empty-box'>Unable to load invites.<br>${escapeHTML(error.message)}</div>`;
        return;
    }

    if(!invites || invites.length === 0){
        list.innerHTML = "<div class='empty-box'>No pending team invites.</div>";
        return;
    }

    list.innerHTML = "";
    for(const inv of invites){
        const card = document.createElement("div");
        card.className = "invite-card";
        card.innerHTML = `
            <h4>👥 ${escapeHTML(inv.teams?.name || "Team")}</h4>
            <div class="invite-info">
                <strong>From:</strong> ${escapeHTML(inv.profiles?.full_name || "Unknown")}<br>
                <strong>ID:</strong> ${escapeHTML(inv.profiles?.inter_rivalry_id || "-")}<br>
                <strong>Sent:</strong> ${formatDate(inv.created_at)}
            </div>
            <div class="invite-actions">
                <button class="btn-3d-sm-white-glow" onclick="acceptTeamInvite('${inv.id}')">✅ ACCEPT</button>
                <button class="btn-3d-sm-white-glow-danger" onclick="declineTeamInvite('${inv.id}')">❌ DECLINE</button>
            </div>`;
        list.appendChild(card);
    }
}

async function leaveTeam(teamId){
    if(!confirm("Leave this team?")) return;

    const { error } = await client.rpc("leave_team", { p_team_id: teamId });
    if(error){ alert("Could not leave team:\n" + error.message); return; }

    await loadMyTeams();
}

async function removeTeamMember(teamId, userId){
    if(!confirm("Remove this member?")) return;

    const { error } = await client.rpc("remove_team_member", {
        p_team_id: teamId,
        p_user_id: userId
    });

    if(error){ alert("Could not remove member:\n" + error.message); return; }

    await viewTeamDetails(teamId);
    await loadMyTeams();
}

async function deleteTeam(teamId){
    if(!confirm("⚠️ Delete this team permanently?")) return;

    const { error } = await client.rpc("delete_team", { p_team_id: teamId });
    if(error){
        alert("Could not delete team:\n" + error.message);
        return;
    }

    alert("Team deleted.");
    backToStudentDashboard();
    await loadMyTeams();
}

// ==================== ADMIN FUNCTIONS ====================
async function loadAdminDashboard(){
    showOnlyAdmin();
    const crPanel = document.getElementById("crAdminPanel");
    if(crPanel) crPanel.style.display = "none";
    const normalizedRole = String(currentUserRole || "").toLowerCase().replace(/[\s-]/g, "_");
    if(normalizedRole === "super_admin"){
        currentAdminCollegeId = null;
        if(crPanel) crPanel.style.display = "none";
        const addCollegeBox = document.querySelector("#adminDashboard .add-college-box");
        if(addCollegeBox) addCollegeBox.style.display = "block";
        const title = document.querySelector("#adminDashboard .section-title");
        if(title) title.textContent = "🏫 Colleges";
        const header = document.querySelector("#adminDashboard .admin-header h1");
        const sub = document.querySelector("#adminDashboard .admin-header p");
        if(header) header.textContent = "👑 Super Admin";
        if(sub) sub.textContent = "INTER RIVALRY platform management";
    }
    const typeSelect = document.getElementById("adminCommunityType");
    if(typeSelect) typeSelect.value = "college";
    toggleAdminCommunityForm();
    await loadAdminStats();
    await loadAdminColleges();
    await loadAdminGyms();
}

async function loadAdminStats(){
    if(["college_admin", "collegeadmin"].includes(String(currentUserRole || "").toLowerCase().replace(/[\s-]/g, "_")) && currentAdminCollegeId){
        const { count: colleges } = await client.from("colleges").select("id",{count:"exact",head:true}).eq("id",currentAdminCollegeId);
        const { count: requests } = await client.from("college_join_requests").select("id",{count:"exact",head:true}).eq("college_id",currentAdminCollegeId).eq("status","pending");
        const { count: students } = await client.from("college_memberships").select("id",{count:"exact",head:true}).eq("college_id",currentAdminCollegeId).eq("is_active",true);
        document.getElementById("collegeCount").textContent = colleges || 0;
        document.getElementById("requestCount").textContent = requests || 0;
        document.getElementById("adminCount").textContent = students || 0;
        const label = document.querySelector("#adminCount")?.parentElement?.querySelector(".label");
        if(label) label.textContent = "Students";
        return;
    }
    const { count: colleges } = await client.from("colleges").select("id",{count:"exact",head:true});
    document.getElementById("collegeCount").textContent = colleges || 0;
    const { count: requests } = await client.from("college_join_requests").select("id",{count:"exact",head:true}).eq("status","pending");
    document.getElementById("requestCount").textContent = requests || 0;
    const { count: admins } = await client.from("college_admins").select("id",{count:"exact",head:true});
    document.getElementById("adminCount").textContent = admins || 0;
    const { count: gyms } = await client.from("gyms").select("id",{count:"exact",head:true});
    const gymCount = document.getElementById("gymCount");
    if(gymCount) gymCount.textContent = gyms || 0;
    const label = document.querySelector("#adminCount")?.parentElement?.querySelector(".label");
    if(label) label.textContent = "College Admins";
}

async function loadAdminColleges(){
    let query = client.from("colleges").select("id,college_name,college_code,city,state").order("college_name",{ascending:true});
    if(["college_admin", "collegeadmin"].includes(String(currentUserRole || "").toLowerCase().replace(/[\s-]/g, "_")) && currentAdminCollegeId){
        query = query.eq("id", currentAdminCollegeId);
    }
    const { data, error } = await query;
    const list = document.getElementById("adminCollegeList");
    list.innerHTML = "";
    if(error || !data || data.length === 0){ list.innerHTML = "<div class='empty-box'>No colleges added yet.</div>"; return; }
    data.forEach(college => {
        const card = document.createElement("div");
        card.className = "college-card";
        card.innerHTML = `<h3>${escapeHTML(college.college_name)}</h3><div class="college-code">Code: ${escapeHTML(college.college_code)}</div><div class="college-location">${escapeHTML(college.city || "")}${college.state ? ", " + escapeHTML(college.state) : ""}</div><button class="btn-3d-sm-white-glow" onclick="viewCollege('${college.id}')">📋 MANAGE</button>`;
        list.appendChild(card);
    });
}

function toggleAdminCommunityForm(){
    const type = document.getElementById("adminCommunityType")?.value || "college";
    const cf = document.getElementById("adminCollegeFields");
    const gf = document.getElementById("adminGymFields");
    const title = document.getElementById("adminCommunityListTitle");
    const gymWrap = document.getElementById("adminGymListWrap");
    if(cf) cf.style.display = type === "college" ? "block" : "none";
    if(gf) gf.style.display = type === "gym" ? "block" : "none";
    if(title) title.textContent = type === "gym" ? "🏋️ Gyms" : "🏫 Colleges";
    if(gymWrap) gymWrap.style.display = type === "gym" ? "block" : "none";
}

async function addSelectedCommunity(){
    const type = document.getElementById("adminCommunityType")?.value || "college";
    if(type === "gym") return addGym();
    return addCollege();
}

async function addGym(){
    const normalizedRole = String(currentUserRole || "").toLowerCase().replace(/[\s-]/g, "_");
    if(normalizedRole !== "super_admin"){ alert("Only the Super Admin can add gyms."); return; }
    const name = document.getElementById("gymName").value.trim();
    const code = document.getElementById("gymCode").value.trim().toUpperCase();
    const city = document.getElementById("communityCity").value.trim();
    const state = document.getElementById("communityState").value.trim();
    const message = document.getElementById("adminMessage");
    if(!name || !code){ message.textContent = "Gym name and code required."; return; }
    message.textContent = "Adding gym...";
    const { error } = await client.from("gyms").insert({ gym_name:name, gym_code:code, city:city || null, state:state || null, country:"India", created_by:(await client.auth.getUser()).data.user?.id });
    if(error){ message.textContent = "Error: " + error.message; return; }
    message.textContent = "✅ Gym added!";
    ["gymName","gymCode","communityCity","communityState"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
    await loadAdminStats();
    await loadAdminGyms();
}

async function loadAdminGyms(){
    const list=document.getElementById("adminGymList");
    if(!list) return;
    const {data,error}=await client.from("gyms").select("id,gym_name,gym_code,city,state").order("gym_name",{ascending:true});
    if(error || !data?.length){ list.innerHTML="<div class='empty-box'>No gyms added yet.</div>"; return; }
    list.innerHTML=data.map(g=>`<div class="college-card"><h3>🏋️ ${escapeHTML(g.gym_name)}</h3><div class="college-code">Code: ${escapeHTML(g.gym_code)}</div><div class="college-location">${escapeHTML(g.city||"")}${g.state?", "+escapeHTML(g.state):""}</div><div style="margin-top:10px;color:#777;font-size:12px;">Gym community • Fitness challenges + rankings</div></div>`).join("");
}

async function addCollege(){
    if(currentUserRole !== "super_admin"){
        alert("Only the Super Admin can add colleges.");
        return;
    }
    const name = document.getElementById("collegeName").value.trim();
    const code = document.getElementById("collegeCode").value.trim().toUpperCase();
    const city = document.getElementById("collegeCity").value.trim();
    const state = document.getElementById("collegeState").value.trim();
    const message = document.getElementById("adminMessage");
    if(!name || !code){ message.textContent = "Name and code required."; return; }
    message.textContent = "Adding college...";
    const { error } = await client.from("colleges").insert({ college_name: name, college_code: code, city: city || null, state: state || null, country: "India" });
    if(error){ message.textContent = "Error: " + error.message; return; }
    message.textContent = "✅ College added!";
    document.getElementById("collegeName").value = ""; document.getElementById("collegeCode").value = ""; document.getElementById("collegeCity").value = ""; document.getElementById("collegeState").value = "";
    await loadAdminStats(); await loadAdminColleges();
}

async function viewCollege(collegeId){
    if(currentUserRole === "college_admin" && currentAdminCollegeId && collegeId !== currentAdminCollegeId){
        alert("You can only manage your assigned college.");
        return;
    }
    selectedCollegeId = collegeId;
    const { data: college, error } = await client.from("colleges").select("id,college_name,college_code,city,state").eq("id",collegeId).single();
    if(error){ alert("Unable to load college."); return; }
    document.getElementById("manageCollegeName").textContent = college.college_name;
    document.getElementById("manageCollegeCode").textContent = college.college_code || "-";
    document.getElementById("manageCollegeCity").textContent = college.city || "-";
    document.getElementById("manageCollegeState").textContent = college.state || "-";
    document.getElementById("manageCollegeLocation").textContent = (college.city || "") + (college.state ? ", " + college.state : "");
    document.getElementById("editCollegeName").value = college.college_name || "";
    document.getElementById("editCollegeCode").value = college.college_code || "";
    document.getElementById("editCollegeCity").value = college.city || "";
    document.getElementById("editCollegeState").value = college.state || "";
    await loadCollegeManagementCounts(collegeId);
    showOnlyCollegeManagement();
    const managementCards = document.querySelectorAll("#collegeManagement .management-card");
    const editCollegeCard = document.querySelector("#collegeManagement .management-grid + .profile-card");
    if(currentUserRole === "college_admin"){
        if(managementCards[0]) managementCards[0].style.display = "none";
        if(editCollegeCard) editCollegeCard.style.display = "none";
    } else {
        if(managementCards[0]) managementCards[0].style.display = "block";
        if(editCollegeCard) editCollegeCard.style.display = "block";
    }
}

async function loadCollegeManagementCounts(collegeId){
    if(!collegeId) return;
    const { count: admins } = await client.from("college_admins").select("id",{count:"exact",head:true}).eq("college_id",collegeId);
    document.getElementById("manageAdminCount").textContent = admins || 0;
    const { count: students } = await client.from("college_memberships").select("id",{count:"exact",head:true}).eq("college_id",collegeId).eq("is_active",true);
    document.getElementById("manageStudentCount").textContent = students || 0;
    const { count: requests } = await client.from("college_join_requests").select("id",{count:"exact",head:true}).eq("college_id",collegeId).eq("status","pending");
    document.getElementById("manageRequestCount").textContent = requests || 0;
}

async function saveCollegeChanges(){
    if(currentUserRole !== "super_admin"){
        alert("Only the Super Admin can edit college information.");
        return;
    }
    if(!selectedCollegeId) return;
    const name = document.getElementById("editCollegeName").value.trim();
    const code = document.getElementById("editCollegeCode").value.trim().toUpperCase();
    const city = document.getElementById("editCollegeCity").value.trim();
    const state = document.getElementById("editCollegeState").value.trim();
    const message = document.getElementById("editMessage");
    if(!name || !code){ message.textContent = "Name and code required."; return; }
    message.textContent = "Saving...";
    const { error } = await client.from("colleges").update({ college_name: name, college_code: code, city: city || null, state: state || null }).eq("id",selectedCollegeId);
    if(error){ message.textContent = "Error: " + error.message; return; }
    message.textContent = "✅ College updated!";
    document.getElementById("manageCollegeName").textContent = name;
    document.getElementById("manageCollegeCode").textContent = code;
    document.getElementById("manageCollegeCity").textContent = city || "-";
    document.getElementById("manageCollegeState").textContent = state || "-";
}

async function openAdmins(){
    if(currentUserRole !== "super_admin"){
        alert("Only the Super Admin can manage College Admins.");
        return;
    }
    if(!selectedCollegeId) return;
    const { data: college } = await client.from("colleges").select("college_name").eq("id",selectedCollegeId).single();
    document.getElementById("adminsCollegeName").textContent = college ? college.college_name : "College";
    await loadAdmins();
    showOnlyAdmins();
}

async function loadAdmins(){
    const { data, error } = await client.from("college_admins").select(`id,user_id,created_at,profiles!college_admins_user_id_fkey(full_name,inter_rivalry_id)`).eq("college_id",selectedCollegeId).order("created_at",{ascending:false});
    const list = document.getElementById("adminsList");
    list.innerHTML = "";
    if(error || !data || data.length === 0){ list.innerHTML = "<div class='empty-box'>No admins assigned.</div>"; return; }
    data.forEach(admin => {
        const profile = admin.profiles;
        const card = document.createElement("div");
        card.className = "admin-card";
        card.innerHTML = `<h3>👤 ${escapeHTML(profile?.full_name || "Unknown")}</h3><div class="admin-info">ID: ${escapeHTML(profile?.inter_rivalry_id || "Unknown")}<br>User ID: ${escapeHTML(admin.user_id)}</div><br><button class="btn-3d-sm-white-glow-danger" onclick="removeCollegeAdmin('${admin.id}')">🗑️ REMOVE ADMIN</button>`;
        list.appendChild(card);
    });
}

async function addCollegeAdmin(){
    const userId = document.getElementById("adminUserId").value.trim();
    const message = document.getElementById("adminManageMessage");
    if(!userId){ message.textContent = "Enter user ID."; return; }
    message.textContent = "Checking user...";
    const { data: profile } = await client.from("profiles").select("id,full_name,role").eq("id",userId).single();
    if(!profile){ message.textContent = "User not found."; return; }
    const { error: roleError } = await client.rpc("assign_college_admin", {
        p_user_id: userId,
        p_college_id: selectedCollegeId
    });
    if(roleError){
        message.textContent = "Error assigning admin: " + roleError.message;
        return;
    }
    message.textContent = "✅ Admin added!";
    document.getElementById("adminUserId").value = "";
    await loadAdmins();
    await loadCollegeManagementCounts(selectedCollegeId);
}

async function removeCollegeAdmin(adminId){
    if(!confirm("Remove this admin?")) return;
    const { data: admin } = await client.from("college_admins").select("user_id").eq("id",adminId).single();
    if(!admin) return;
    const { error } = await client.rpc("remove_college_admin", { p_admin_id: adminId });
    if(error){
        alert("Could not remove admin: " + error.message);
        return;
    }
    await loadAdmins();
    await loadCollegeManagementCounts(selectedCollegeId);
}

async function openStudents(){
    const { data: college } = await client.from("colleges").select("college_name").eq("id",selectedCollegeId).single();
    document.getElementById("studentsCollegeName").textContent = college ? college.college_name : "College";
    await loadStudents();
    showOnlyStudents();
}

async function openRequests(){
    if(!selectedCollegeId){ alert("No college selected."); return; }
    const { data: college } = await client.from("colleges").select("college_name").eq("id",selectedCollegeId).single();
    document.getElementById("requestsCollegeName").textContent = college ? college.college_name : "College";
    await loadRequests();
    showOnlyRequests();
}

async function loadRequests(){
    const list = document.getElementById("requestsList");
    if(!list) return;
    list.innerHTML = "<div class='empty-box'>Loading requests...</div>";
    if(!selectedCollegeId){ list.innerHTML = "<div class='empty-box'>No college selected.</div>"; return; }
    try {
        const { data, error } = await client.from("college_join_requests")
            .select(`id,student_id,course,year_of_study,department,specialization,status,created_at,profiles!college_join_requests_student_id_fkey(full_name,inter_rivalry_id)`)
            .eq("college_id", selectedCollegeId).eq("status", "pending").order("created_at", { ascending: true });
        if(error){ list.innerHTML = `<div class='empty-box'>Error: ${escapeHTML(error.message)}</div>`; return; }
        const validRequests = (data || []).filter(r => r.profiles !== null);
        if(!validRequests || validRequests.length === 0){ list.innerHTML = "<div class='empty-box'>🎉 No pending join requests.</div>"; return; }
        list.innerHTML = "";
        for(const request of validRequests){
            const profile = request.profiles;
            const card = document.createElement("div"); card.className = "request-card";
            card.innerHTML = `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px;">
                    <div>
                        <h3>📩 ${escapeHTML(profile?.full_name || "Unknown")}</h3>
                        <div class="request-info"><strong>INTER RIVALRY ID:</strong> ${escapeHTML(profile?.inter_rivalry_id || "Not assigned")}
                        <br><strong>Course:</strong> ${escapeHTML(request.course || "-")}
                        <br><strong>Year:</strong> ${escapeHTML(request.year_of_study || "-")}
                        <br><strong>Department:</strong> ${escapeHTML(request.department || "-")}
                        <br><strong>Specialization:</strong> ${escapeHTML(request.specialization || "-")}
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
    } catch(error) { list.innerHTML = `<div class='empty-box'>Error: ${escapeHTML(error.message)}</div>`; }
}

// ==================== REVIEW REQUEST ====================
async function reviewRequest(requestId, approve){
    const action = approve ? "APPROVE" : "REJECT";
    if(!confirm(`Are you sure you want to ${action} this request?`)) return;
    const { error } = await client.rpc("review_college_join_request", { p_request_id: requestId, p_approve: approve });
    if(error){ console.error(error); alert("Could not " + action.toLowerCase() + " request:\n" + error.message); return; }
    alert(approve ? "✅ Student approved successfully!" : "❌ Request rejected.");
    await loadRequests();
    await loadCollegeManagementCounts(selectedCollegeId);
}

async function loadCollegeAdminDashboard(user, profile){
    const { data: admin, error } = await client
        .from("college_admins")
        .select("college_id,colleges(college_name,college_code,city,state)")
        .eq("user_id", user.id)
        .maybeSingle();

    if(error || !admin){
        alert("No college assigned.");
        showAuth();
        return;
    }

    currentAdminCollegeId = admin.college_id;
    showOnlyAdmin();

    // College admins must never see Super Admin controls.
    const dashboard = document.getElementById("adminDashboard");
    const addCollegeBox = dashboard?.querySelector(".add-college-box");
    const manageAdminCards = dashboard?.querySelectorAll(".management-card");

    if(addCollegeBox) addCollegeBox.style.display = "none";

    // Hide the global college-admin management route from college admins.
    const globalAdminButtons = dashboard?.querySelectorAll(
        "button[onclick*=openAdmins], button[onclick*=saveCollegeChanges]"
    );
    globalAdminButtons?.forEach(btn => btn.style.display = "none");

    document.querySelector("#adminDashboard .admin-header h1").textContent =
        "🏫 " + (admin.colleges ? admin.colleges.college_name : "College Admin");
    document.querySelector("#adminDashboard .admin-header p").textContent =
        "Manage your college students, requests and CR elections only";

    const roleBadge = dashboard?.querySelector(".navbar .role-badge");
    if(roleBadge) roleBadge.textContent = "COLLEGE ADMIN";

    // College admin statistics are limited to their assigned college.
    await loadAdminStats();
    await loadAdminColleges();
    await prepareCrAdminPanel(admin.college_id);
}

async function prepareCrAdminPanel(collegeId){
    currentAdminCollegeId = collegeId;
    const panel=document.getElementById('crAdminPanel');
    if(panel) panel.style.display='block';
    const msg=document.getElementById('crAdminMessage');
    if(msg) msg.textContent='Ready to open an election for this college.';
}

async function openCrElectionAsAdmin(){
    const msg=document.getElementById('crAdminMessage');
    if(!currentAdminCollegeId){ if(msg)msg.textContent='College could not be identified.'; return; }
    const course=document.getElementById('crAdminCourse').value;
    const year=Number(document.getElementById('crAdminYear').value);
    const specialization=document.getElementById('crAdminSpecialization').value.trim();
    const days=Number(document.getElementById('crAdminDuration').value);
    if(!confirm(`Open CR election for ${course}, Year ${year}${specialization?' • '+specialization:''} for ${days} days?`)) return;
    const {data:{user}}=await client.auth.getUser();
    if(!user){ if(msg)msg.textContent='Please log in again.'; return; }
    const {data:existing}=await client.from('cr_elections').select('id,status').eq('college_id',currentAdminCollegeId).eq('course',course).eq('year_of_study',year).eq('specialization',specialization).in('status',['draft','open']).eq('is_active',true).limit(1);
    if(existing&&existing.length){ if(msg)msg.textContent='An active or draft election already exists for this class.'; return; }
    const {error}=await client.from('cr_elections').insert({college_id:currentAdminCollegeId,course,year_of_study:year,specialization,status:'open',is_active:true,starts_at:new Date().toISOString(),ends_at:new Date(Date.now()+days*86400000).toISOString(),created_by:user.id});
    if(error){console.error(error);if(msg)msg.textContent='Could not open election: '+error.message;return;}
    if(msg)msg.textContent='✅ Election opened successfully for '+days+' days.';
}



// ==================== IR COINS ECONOMY ====================
let IR_OWNED_ITEMS = new Set();
const IR_GOLD_FRAME_ART = 'data:image/webp;base64,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';
const IR_SHOP_ITEMS = [
 {id:'profile_frame_gold',name:'Golden Profile Frame',description:'A gold frame shown on your profile.',cost:500,icon:'🟨'},
 {id:'nameplate_gold',name:'Golden Nameplate',description:'A special gold nameplate for your profile.',cost:1000,icon:'👑'},
 {id:'title_elite',name:'Elite Competitor Title',description:'Unlock an exclusive profile title.',cost:1500,icon:'🏅'},
 {id:'champion_banner',name:'Champion Banner',description:'A digital champion-style profile banner.',cost:2000,icon:'🏆'},
 {id:'profile_theme_limited',name:'Limited Profile Theme',description:'A special profile theme.',cost:3000,icon:'✨'},
 {id:'club_banner',name:'Club Banner',description:'Unlock a cosmetic banner for a Local Club you captain.',cost:500,icon:'🏟️'},
 {id:'club_badge',name:'Exclusive Club Badge',description:'Unlock a cosmetic badge for a Local Club you captain.',cost:1000,icon:'🛡️'},
 {id:'club_title',name:'Season Club Title',description:'Unlock a special club title.',cost:1500,icon:'🥇'},
 {id:'special_tournament_ticket',name:'Special Tournament Ticket',description:'A virtual ticket flag for eligible special tournaments. It does not guarantee entry; tournament rules still apply.',cost:500,icon:'🎟️'}
];
async function openIRCoinsPage(){
 hideAll();
 const page=document.getElementById('irCoinsPage');
 if(page) page.classList.remove('hidden');
 await loadIRCoinsPage();
}
async function loadIRCoinsPage(){
 const {data:{user:shopUser}} = await client.auth.getUser();
 IR_OWNED_ITEMS = new Set();
 if(shopUser){
   const {data:owned,error:ownedError}=await client.from('ir_coin_inventory').select('item_code').eq('user_id',shopUser.id);
   if(ownedError) console.warn('IR inventory could not be loaded:',ownedError.message);
   else IR_OWNED_ITEMS = new Set((owned||[]).map(x=>x.item_code));
 }
 const balanceEl=document.getElementById('irCoinBalance');
 const statusEl=document.getElementById('irCoinStatus');
 if(balanceEl) balanceEl.textContent='Loading…';
 const {data:wallet,error}=await client.rpc('ir_get_wallet');
 if(error){
   console.error('IR wallet load:',error);
   if(balanceEl) balanceEl.textContent='Not ready';
   if(statusEl) statusEl.textContent='Run the IR Coins SQL migration in Supabase first. Details: '+error.message;
   renderIRShop();
   return;
 }
 const row=Array.isArray(wallet)?wallet[0]:wallet;
 if(balanceEl) balanceEl.textContent=Number(row?.balance||0).toLocaleString()+' IR';
 if(statusEl) statusEl.textContent='Virtual currency only · No cash value';
 renderIRShop();
 const {data:freeze}=await client.rpc('ir_get_rank_freeze');
 const freezeEl=document.getElementById('irRankFreezeStatus');
 if(freezeEl) freezeEl.textContent=freeze?.active_until ? 'Active until '+new Date(freeze.active_until).toLocaleString() : 'No active rank freeze.';
 const {data:history,error:historyError}=await client.rpc('ir_get_coin_history');
 const histEl=document.getElementById('irCoinHistory');
 if(histEl){
   if(historyError) histEl.textContent='History unavailable: '+historyError.message;
   else if(!history?.length) histEl.textContent='No transactions yet.';
   else histEl.innerHTML=history.map(x=>`<div style="padding:10px 0;border-bottom:1px solid #292929;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;"><span>${escapeHTML(x.description||x.reason||'IR transaction')}<br><small style="color:#777;">${x.created_at?new Date(x.created_at).toLocaleString():''}</small></span><b style="color:${Number(x.amount)>=0?'#7bed9f':'#ff7675'}">${Number(x.amount)>0?'+':''}${Number(x.amount).toLocaleString()} IR</b></div>`).join('');
 }
 const clubsEl=document.getElementById('irClubItems');
 if(clubsEl) clubsEl.innerHTML=IR_SHOP_ITEMS.filter(x=>x.id.startsWith('club_')).map(irItemCard).join('');
}
function renderIRShop(){
 const el=document.getElementById('irCoinShop');
 if(el) el.innerHTML=IR_SHOP_ITEMS.filter(x=>!x.id.startsWith('club_') && !x.id.startsWith('rank_freeze')).map(irItemCard).join('');
 const clubs=document.getElementById('irClubItems');
 if(clubs) clubs.innerHTML=IR_SHOP_ITEMS.filter(x=>x.id.startsWith('club_')).map(irItemCard).join('');
}
function irItemCard(item){
 const owned=IR_OWNED_ITEMS.has(item.id);
 const isFrame=item.id==='profile_frame_gold';
 const art=isFrame ? `<img src="${IR_GOLD_FRAME_ART}" alt="Ornate golden profile frame artwork" loading="lazy">` : `<div class="ir-shop-glyph">${item.icon}</div>`;
 const kind=item.id.startsWith('club_')?'CLUB COSMETIC':(item.id==='profile_frame_gold'?'PROFILE COSMETIC':'DIGITAL REWARD');
 return `<article class="ir-shop-item"><div class="ir-shop-art">${isFrame?'<span class="ir-shop-ribbon">✦ LEGENDARY</span>':''}${art}</div><div class="ir-shop-content"><div class="ir-shop-kicker">${kind}</div><h3 class="ir-shop-title">${escapeHTML(item.name)}</h3><p class="ir-shop-desc">${escapeHTML(item.description)}</p></div><div class="ir-shop-bottom"><div class="ir-shop-price">${item.cost.toLocaleString()} IR<small>VIRTUAL COINS</small></div>${owned?'<span style="font-size:10px;font-weight:900;letter-spacing:1px;color:#91e6b1">✓ OWNED</span>':''}</div><button class="btn-3d-sm-white-glow-gold ir-shop-buy" ${owned?'disabled style="opacity:.58;cursor:default"':''} onclick="buyIRItem('${item.id}')">${owned?(isFrame?'✓ OWNED · ON PROFILE':'✓ UNLOCKED'):'UNLOCK REWARD  ↗'}</button></article>`;
}
async function buyIRItem(itemId){
 const item=IR_SHOP_ITEMS.find(x=>x.id===itemId);
 if(!item){alert('Unknown IR item.');return;}
 if(IR_OWNED_ITEMS.has(itemId)){alert('You already own this reward.');return;}
 if(!confirm(`Unlock ${item.name} for ${item.cost.toLocaleString()} IR Coins?`)) return;
 const {data,error}=await client.rpc('ir_purchase_item',{p_item_code:item.id});
 if(error){alert('Could not complete purchase: '+error.message);return;}
 alert(data?.message || 'Purchase successful!');
 await loadIRCoinsPage();
}

// ==================== UTILITY FUNCTIONS ====================
function escapeHTML(value){ if(value === null || value === undefined) return ""; return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function formatDate(value){ if(!value) return "-"; const date = new Date(value); if(isNaN(date.getTime())) return "-"; return date.toLocaleString(); }

// ==================== AUTH STATE ====================
client.auth.onAuthStateChange((event, session) => {
    if(event === "PASSWORD_RECOVERY"){
        // Supabase sends this event when the user lands on the recovery link.
        setTimeout(() => showResetPassword(), 0);
    } else if(event === "SIGNED_IN"){
        // Do not send a password-recovery session to the normal dashboard.
        if(!isPasswordRecoveryUrl()) setTimeout(() => loadUser(), 0);
    } else if(event === "SIGNED_OUT"){
        showAuth();
    }
});

// ==================== INITIALIZE ====================
async function initialize(){
    const recoveryUrl = isPasswordRecoveryUrl();
    const { data: { session } } = await client.auth.getSession();
    if(recoveryUrl){
        if(session) showResetPassword();
        else showAuth();
        return;
    }
    if(session){ await loadUser(); }
    else { showAuth(); }
}
initialize();

/* ===== Extracted from the original INTER RIVALRY HTML; order preserved ===== */

function openIRGamesHub(){const el=document.getElementById('irGamesHubModal');if(el){el.style.display='flex';document.body.style.overflow='hidden';}}
function closeIRGamesHub(){const el=document.getElementById('irGamesHubModal');if(el){el.style.display='none';document.body.style.overflow='';}}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeIRGamesHub();});
