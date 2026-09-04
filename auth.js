// ==================== AUTH FUNCTIONS ====================
function showMessage(msg){ document.getElementById("authMessage").textContent = msg; }
function showSignup(){ document.getElementById("loginForm").classList.add("hidden"); document.getElementById("signupForm").classList.remove("hidden"); showMessage(""); }
function showLogin(){ document.getElementById("signupForm").classList.add("hidden"); document.getElementById("loginForm").classList.remove("hidden"); showMessage(""); }
function showAuth(){ hideAll(); document.getElementById("authPage").classList.remove("hidden"); }

async function signup(){
    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    if(!name || !email || !password){ showMessage("Please fill in all fields."); return; }
    if(password.length < 6){ showMessage("Password must be at least 6 characters."); return; }
    showMessage("Creating account...");
    const { data, error } = await client.auth.signUp({
        email, password,
        options: { emailRedirectTo: "https://inter-rivalry.github.io/Inter-Rivalry-BCU/", data: { full_name: name } }
    });
    if(error){ showMessage(error.message); return; }
    if(!data.session){ showMessage("Account created! Check your email to confirm."); return; }
    const { error: profileError } = await client.from("profiles").insert({
        id: data.user.id, full_name: name, role: 'student', inter_rivalry_id: null, college_joined: false
    });
    if(profileError){ console.error("Profile creation error:", profileError); showMessage("Account created but profile setup failed."); return; }
    showMessage("✅ Account created! Please join a college to get your INTER RIVALRY ID.");
    await requestNotificationPermission();
    await registerDevice();
    await loadUser();
}

async function login(){
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    if(!email || !password){ showMessage("Please enter your email and password."); return; }
    showMessage("Logging in...");
    const { error } = await client.auth.signInWithPassword({ email, password });
    if(error){ showMessage(error.message); return; }
    await requestNotificationPermission();
    await registerDevice();
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
