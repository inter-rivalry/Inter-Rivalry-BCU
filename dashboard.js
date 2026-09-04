// ==================== NAVIGATION ====================
function hideAll(){
    document.querySelectorAll("section").forEach(s => s.classList.add("hidden"));
    document.getElementById("loadingScreen").classList.add("hidden");
    document.getElementById("leaderboardPage").classList.add("hidden");
    document.getElementById("tournamentsPage").classList.add("hidden");
    document.getElementById("categoryRankingsPage").classList.add("hidden");
    document.getElementById("toolboxPage").classList.add("hidden");
    document.getElementById("quizBattlePage").classList.add("hidden");
    document.getElementById("gradebookPage").classList.add("hidden");
}

function backToStudentDashboard(){
    document.getElementById("createTeamPage").classList.add("hidden");
    document.getElementById("teamDetailsPage").classList.add("hidden");
    document.getElementById("studentDashboard").classList.remove("hidden");
    if(currentUserProfile && currentUserProfile.college_joined){
        loadMyTeams();
        loadTeamInvites();
        loadMyInterestSummary();
        loadMyQuickStats();
        loadNotifications();
    }
    loadStudentDashboardFromCurrentUser();
}
function backToProfile(){ document.getElementById("profilePage").classList.remove("hidden"); document.getElementById("challengePage").classList.add("hidden"); }
function backToAdmin(){ selectedCollegeId = null; loadAdminDashboard(); }
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

// ==================== LOAD USER ====================
async function loadUser(){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ showAuth(); return; }
    const { data: profile, error } = await client.from("profiles").select("*").eq("id",user.id).single();
    if(error || !profile){ console.error(error); showAuth(); return; }
    currentUserRole = profile.role || '';
    currentUserProfile = profile;
    if(profile.role === "super_admin"){ await loadAdminDashboard(); return; }
    if(profile.role === "college_admin"){ await loadCollegeAdminDashboard(user, profile); return; }
    await loadStudentDashboard(user, profile);
}

async function loadStudentDashboardFromCurrentUser(){
    const { data: { user } } = await client.auth.getUser();
    if(!user){ showAuth(); return; }
    const { data: profile } = await client.from("profiles").select("*").eq("id",user.id).single();
    if(profile){ currentUserProfile = profile; await loadStudentDashboard(user, profile); }
}

// ==================== STUDENT DASHBOARD ====================
async function loadStudentDashboard(user, profile){
    document.getElementById("userName").textContent = profile.full_name || "Student";
    const { data: membership } = await client.from("college_memberships").select("college_id,department,course,year_of_study,specialization,colleges(college_name,college_code,city,state)").eq("user_id", user.id).eq("is_active", true).maybeSingle();
    const collegeStatus = document.getElementById("collegeStatus");
    const hasJoinedCollege = membership && membership.colleges;
    if(!hasJoinedCollege){
        document.getElementById("studentCollegeSection").style.display = "block";
        await loadStudentColleges();
        document.getElementById("myQuickStats").innerHTML = "";
        document.getElementById("interestsSection").style.display = "none";
        document.getElementById("teamsSection").style.display = "none";
        document.getElementById("teamInvitesSection").style.display = "none";
        document.getElementById("battlefieldSection").style.display = "none";
        document.getElementById("rivalsSectionFull").style.display = "none";
        document.getElementById("actionButtons").style.display = "none";
        document.getElementById("bottomButtons").style.display = "none";
        document.getElementById("rivalryId").textContent = "Not assigned";
        document.getElementById("rivalryId").style.color = "#ff6b6b";
        collegeStatus.textContent = "❗ College: Not joined yet - Please join below!";
        collegeStatus.style.color = "#fdcb6e";
        document.getElementById("welcomeSubText").textContent = "⚠️ Join a college to unlock all features!";
        document.getElementById("emptyRankMessage").innerHTML = `<div style="color:#fdcb6e;font-size:18px;font-weight:700;margin-bottom:10px;">🏛️ College Required</div><p style="color:#888;">You must join a college to access all features.</p><p style="color:#666;font-size:14px;margin-top:10px;">Select a college above to get started!</p>`;
        showOnlyStudent();
        return;
    }
    if(!profile.inter_rivalry_id){
        const collegeCode = membership.colleges?.college_code || 'XXXX';
        const randomNum = String(Math.floor(1000 + Math.random() * 9000));
        const newRivalryId = `IR-${collegeCode}-${randomNum}`;
        await client.from("profiles").update({ inter_rivalry_id: newRivalryId, college_joined: true }).eq("id", user.id);
        profile.inter_rivalry_id = newRivalryId;
        profile.college_joined = true;
        currentUserProfile = profile;
        showMessage(`🎉 Welcome! Your INTER RIVALRY ID: ${newRivalyId}`);
    }
    document.getElementById("rivalryId").textContent = profile.inter_rivalry_id || "Not assigned";
    document.getElementById("rivalryId").style.color = "#00d2ff";
    collegeStatus.textContent = "✅ College: " + membership.colleges.college_name + " (" + membership.colleges.college_code + ")";
    collegeStatus.style.color = "#00b894";
    document.getElementById("studentCollegeSection").style.display = "none";
    document.getElementById("welcomeSubText").textContent = "Your rivalry journey starts here.";
    document.getElementById("emptyRankMessage").innerHTML = "No skill ranks yet.<br>Participate in a skill to begin your ranking journey.";
    document.getElementById("interestsSection").style.display = "block";
    document.getElementById("teamsSection").style.display = "block";
    document.getElementById("teamInvitesSection").style.display = "block";
    document.getElementById("battlefieldSection").style.display = "block";
    document.getElementById("rivalsSectionFull").style.display = "block";
    document.getElementById("actionButtons").style.display = "flex";
    document.getElementById("bottomButtons").style.display = "grid";
    
    // Lazy load - only load what's needed
    await loadMyInterestSummary();
    await loadNotifications();
    showOnlyStudent();
}

// ==================== STUDENT COLLEGES ====================
async function loadStudentColleges(){
    const { data, error } = await client.from("colleges").select("id,college_name,college_code,city,state").order("college_name",{ascending:true});
    const list = document.getElementById("collegeList");
    list.innerHTML = "";
    if(error || !data || data.length === 0){ list.innerHTML = "<div class='empty-box'>No colleges available.</div>"; return; }
    data.forEach(college => {
        const card = document.createElement("div");
        card.className = "college-card";
        card.style.borderColor = "#fdcb6e";
        card.style.borderWidth = "2px";
        card.innerHTML = `<h3 style="color:#fdcb6e;">🏛️ ${escapeHTML(college.college_name)}</h3><div class="college-code">${escapeHTML(college.college_code)}</div><div class="college-location">${escapeHTML(college.city || "")}${college.state ? ", " + escapeHTML(college.state) : ""}</div><button class="btn-3d-white-glow-gold" onclick="showJoinForm('${college.id}')" style="margin-top:10px;padding:12px;">🎯 JOIN COLLEGE TO GET ID</button>`;
        list.appendChild(card);
    });
}

async function showJoinForm(collegeId){
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);display:flex;justify-content:center;align-items:center;z-index:9999;padding:20px;backdrop-filter:blur(10px);`;
    const modal = document.createElement('div');
    modal.style.cssText = `background:#1a1a1a;border:1px solid #333;border-radius:20px;padding:40px;max-width:500px;width:100%;max-height:90vh;overflow-y:auto;`;
    let selectedCourse = null; let selectedYear = null; let selectedSpecialization = null;
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
            if(selectedCourse === 'BCA') { document.getElementById('specializationSection').style.display = 'block'; } 
            else { document.getElementById('specializationSection').style.display = 'none'; selectedSpecialization = null; document.getElementById('selectedSpecDisplay').textContent = 'Not needed'; document.getElementById('selectedSpecDisplay').style.color = '#888'; }
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
            confirmBtn.disabled = false; confirmBtn.textContent = '✅ CONFIRM & JOIN'; confirmBtn.style.opacity = '1';
        } else {
            confirmBtn.disabled = true; confirmBtn.textContent = '⚠️ SELECT ALL FIELDS'; confirmBtn.style.opacity = '0.5';
        }
    }
    document.getElementById('cancelJoinBtn').addEventListener('click', function() { document.body.removeChild(overlay); });
    document.getElementById('confirmJoinBtn').addEventListener('click', async function() {
        const msg = document.getElementById('joinMessage');
        if(!selectedCourse || !selectedYear || (selectedCourse === 'BCA' && !selectedSpecialization)) { 
            msg.textContent = 'Please select all fields';
            msg.style.color = '#ff6b6b';
            return; 
        }
        this.textContent = '⏳ PROCESSING...'; this.disabled = true;
        const { data: { user } } = await client.auth.getUser();
        if(!user){ alert('Please login first.'); document.body.removeChild(overlay); return; }
        const { error } = await client.from('college_join_requests').insert({
            student_id: user.id, college_id: collegeId,
            course: selectedCourse, year_of_study: parseInt(selectedYear),
            specialization: selectedSpecialization
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
