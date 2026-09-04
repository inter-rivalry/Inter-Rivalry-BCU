// ==================== SUPABASE CONFIG ====================
const SUPABASE_URL = "https://qfkxvflyzucvkeyucbzn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Se88Rw_onDUYfnMHxogs2g_q6WGY_3T";
const client = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// ==================== GLOBALS ====================
let selectedCollegeId = null;
let selectedProfileId = null;
let allRivalsCache = [];
let rivalInterestMap = new Map();
let rivalAcademicMap = new Map();
let interestSkillCache = [];
let currentInterestIds = new Set();
let selectedChallengeMode = "solo";
let leaderboardData = [];
let currentLeaderboardFilter = 'overall';
let currentUserRank = null;
let allStudentsData = [];
let allRivalsData = [];
let rivalsVisible = false;
let currentUserRole = '';
let allGames = [];
let currentGameFilter = 'all';
let currentQuizSession = null;
let currentQuestions = [];
let currentQuestionIndex = 0;
let playerScore = 0;
let opponentScore = 0;
let selectedCategory = 'all';
let quizTimer = null;
let timeLeft = 30;
let currentGradeTab = 'subjects';
let mySubjects = [];
let currentUserProfile = null;
let rivalsLoading = false;
let rivalsLoaded = false;

// ==================== UTILITY FUNCTIONS ====================
function escapeHTML(value){ if(value === null || value === undefined) return ""; return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function formatDate(value){ if(!value) return "-"; const date = new Date(value); if(isNaN(date.getTime())) return "-"; return date.toLocaleString(); }
