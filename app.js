(() => {
  const configured = window.SUPABASE_URL?.startsWith("https://") &&
    window.SUPABASE_ANON_KEY && !window.SUPABASE_ANON_KEY.includes("PASTE_");
  const db = configured && window.supabase
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }) : null;
  const $ = (s) => document.querySelector(s);
  const say = (id, message, bad=false) => { const el=$(id); if(el){el.textContent=message;el.classList.toggle("error",bad);} };
  const safe = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const ready = () => { if(!db) { alert("Add your Supabase URL and publishable/anon key in js/config.js first."); return false; } return true; };
  const roleNames = {admin:"Administrator",teacher:"Teacher",parent:"Parent"};
  $("#menuBtn").addEventListener("click",()=>$("#nav").classList.toggle("open"));
  $("#emailLink").href = window.SCHOOL_EMAIL?.includes("@") ? `mailto:${window.SCHOOL_EMAIL}` : "mailto:";
  $("#emailLink").textContent = window.SCHOOL_EMAIL?.includes("@") ? window.SCHOOL_EMAIL : "Email the school";
  if (/^\d{10,15}$/.test(window.SCHOOL_WHATSAPP || "")) $("#whatsappLink").href = `https://wa.me/${window.SCHOOL_WHATSAPP}`;

  $("#admissionForm").addEventListener("submit", async e => {
    e.preventDefault(); if(!ready()) return;
    const f = new FormData(e.currentTarget);
    const payload = Object.fromEntries(f.entries());
    payload.notes = payload.notes || null;
    const { error } = await db.from("admission_enquiries").insert(payload);
    if(error) { say("#admissionMessage", "Could not submit. Check the Supabase setup and public admission policy, then try again. ("+error.message+")", true); return; }
    e.currentTarget.reset();
    say("#admissionMessage", "Enquiry received. Please contact the school to confirm next steps. This is not a final admission offer.");
  });

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault(); if(!ready()) return;
    const f = new FormData(e.currentTarget);
    const { data, error } = await db.auth.signInWithPassword({email:f.get("email"),password:f.get("password")});
    if(error) { say("#loginMessage", "Sign-in failed. Check your details or use password reset. Repeated failures may be rate-limited by Supabase.", true); return; }
    say("#loginMessage","");
    await renderDashboard(data.user);
  });
  $("#resetPassword").addEventListener("click", async () => {
    if(!ready()) return;
    const email = $("#loginForm [name=email]").value.trim();
    if(!email) return say("#loginMessage","Enter your email first, then choose Forgot password.",true);
    const {error}=await db.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});
    say("#loginMessage",error ? "Could not send reset email. Check Supabase email settings." : "If the account exists, password reset instructions will be sent.");
  });
  $("#signOut").addEventListener("click", async()=>{ if(db) await db.auth.signOut(); $("#dashboard").classList.add("hidden"); $("#portal").classList.remove("hidden"); });
  async function renderDashboard(user) {
    $("#portal").classList.add("hidden"); $("#dashboard").classList.remove("hidden");
    $("#welcomeTitle").textContent = "Your dashboard"; $("#roleLabel").textContent = "Loading account permissions…";
    const {data:profile,error}=await db.from("profiles").select("display_name,role").eq("id",user.id).maybeSingle();
    if(error || !profile) { $("#roleLabel").textContent="Account profile not found. Ask the administrator to create/assign your profile."; $("#dashboardContent").innerHTML='<div class="notice">For security, new users cannot choose their own role. An administrator must assign it.</div>'; return; }
    $("#welcomeTitle").textContent = `Welcome${profile.display_name ? ", "+profile.display_name : ""}`;
    $("#roleLabel").textContent = roleNames[profile.role] || "School user";
    if(profile.role==="admin") await adminView();
    else if(profile.role==="teacher") await teacherView(user);
    else if(profile.role==="parent") await parentView(user);
    else $("#dashboardContent").innerHTML='<div class="notice">Your account role is not configured. Contact the administrator.</div>';
  }
  async function adminView() {
    const [students, staff, applications, today] = await Promise.all([
      db.from("students").select("id",{count:"exact",head:true}).eq("active",true),
      db.from("profiles").select("id",{count:"exact",head:true}).eq("role","teacher").eq("active",true),
      db.from("admission_enquiries").select("id",{count:"exact",head:true}).eq("status","submitted"),
      db.from("attendance_records").select("id",{count:"exact",head:true}).eq("attendance_date",new Date().toISOString().slice(0,10))
    ]);
    $("#dashboardContent").innerHTML = `
      <div class="stats"><div class="stat"><small>Active students</small><strong>${students.count ?? "—"}</strong></div><div class="stat"><small>Active teachers</small><strong>${staff.count ?? "—"}</strong></div><div class="stat"><small>New applications</small><strong>${applications.count ?? "—"}</strong></div><div class="stat"><small>Attendance records today</small><strong>${today.count ?? "—"}</strong></div></div>
      <div class="dashboard-columns"><section class="panel"><h3>Recent admission enquiries</h3><div id="applicationsList">Loading…</div></section><section class="panel"><h3>Publish a school notice</h3><form id="noticeForm"><label>Title<input name="title" required maxlength="160"></label><label>Message<textarea name="body" required maxlength="3000"></textarea></label><label>Audience<select name="audience"><option value="all">All portal users</option><option value="parents">Parents</option><option value="teachers">Teachers</option></select></label><button class="btn primary">Publish notice</button><p id="noticeMessage" class="form-message"></p></form></section></div>
      <div class="panel"><h3>Attendance summary</h3><p>Use the daily/monthly filters and export/print after implementing the report query below. Do not use the displayed record count as an attendance percentage.</p><label>Month<input id="monthFilter" type="month" value="${new Date().toISOString().slice(0,7)}"></label><button id="loadMonthly" class="btn ghost">Load monthly totals</button><div id="monthlySummary"></div></div>`;
    const {data:apps}=await db.from("admission_enquiries").select("id,student_name,class_requested,guardian_name,guardian_phone,created_at,status").order("created_at",{ascending:false}).limit(10);
    $("#applicationsList").innerHTML = apps?.length ? `<div class="table-wrap"><table><thead><tr><th>Applicant</th><th>Class</th><th>Guardian</th><th>Status</th><th>Action</th></tr></thead><tbody>${apps.map(a=>`<tr><td>${safe(a.student_name)}</td><td>${safe(a.class_requested)}</td><td>${safe(a.guardian_name)}<br>${safe(a.guardian_phone)}</td><td>${safe(a.status)}</td><td><button class="small-btn" data-app="${a.id}">Mark reviewing</button></td></tr>`).join("")}</tbody></table></div>` : "No applications yet.";
    $("#applicationsList").querySelectorAll("[data-app]").forEach(b=>b.addEventListener("click",async()=>{const {error}=await db.from("admission_enquiries").update({status:"reviewing"}).eq("id",b.dataset.app); if(error) alert("Could not update status; check policies."); else await adminView();}));
    $("#noticeForm").addEventListener("submit",async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(e.currentTarget));const {error}=await db.from("announcements").insert({title:p.title,body:p.body,audience:p.audience,created_by:(await db.auth.getUser()).data.user.id});say("#noticeMessage",error?"Could not publish notice. Check SQL policies.":"Notice published.",!!error);if(!error)e.currentTarget.reset();});
    $("#loadMonthly").addEventListener("click",async()=>{const month=$("#monthFilter").value;if(!month)return;const start=month+"-01";const end=new Date(Number(month.slice(0,4)),Number(month.slice(5,7)),1).toISOString().slice(0,10);const {data,error}=await db.from("attendance_records").select("status,attendance_date").gte("attendance_date",start).lt("attendance_date",end);if(error){$("#monthlySummary").textContent="Could not load totals; check permissions.";return;}const counts={present:0,absent:0,late:0};(data||[]).forEach(r=>counts[r.status]=(counts[r.status]||0)+1);$("#monthlySummary").innerHTML=`<p>Records in month: ${(data||[]).length}. Present: ${counts.present||0}; absent: ${counts.absent||0}; late: ${counts.late||0}.</p>`;});
  }
  async function teacherView(user) {
    const {data:classes,error}=await db.from("classes").select("id,name,level").order("sort_order");
    if(error){$("#dashboardContent").innerHTML='<div class="notice">Could not load classes. Ask the administrator to check your permissions.</div>';return;}
    $("#dashboardContent").innerHTML=`<div class="panel"><h3>Take class attendance</h3><label>Class<select id="classPick"><option value="">Choose class</option>${(classes||[]).map(c=>`<option value="${c.id}">${safe(c.name)}</option>`).join("")}</select></label><label>Date<input id="attDate" type="date" value="${new Date().toISOString().slice(0,10)}"></label><button id="loadRoster" class="btn primary">Load class roster</button><div id="roster"></div></div><div class="panel"><h3>Teacher notices</h3><div id="teacherNotices">Loading…</div></div>`;
    $("#loadRoster").addEventListener("click",async()=>{const cid=$("#classPick").value,date=$("#attDate").value;if(!cid||!date)return;const {data:students,error}=await db.from("students").select("id,student_code,full_name").eq("class_id",cid).eq("active",true).order("full_name");if(error){$("#roster").textContent="Unable to load students. Check class assignment and RLS.";return;}const {data:existing}=await db.from("attendance_records").select("student_id,status").eq("class_id",cid).eq("attendance_date",date);const old=Object.fromEntries((existing||[]).map(r=>[r.student_id,r.status]));$("#roster").innerHTML=students?.length?`<form id="attendanceForm"><div class="table-wrap"><table><thead><tr><th>Student</th><th>Attendance</th></tr></thead><tbody>${students.map(s=>`<tr><td>${safe(s.full_name)}<small class="subline">${safe(s.student_code)}</small></td><td><select name="${s.id}"><option value="present" ${old[s.id]==="present"?"selected":""}>Present</option><option value="absent" ${old[s.id]==="absent"?"selected":""}>Absent</option><option value="late" ${old[s.id]==="late"?"selected":""}>Late</option></select></td></tr>`).join("")}</tbody></table></div><button class="btn primary">Save attendance</button><p id="attendanceMessage" class="form-message"></p></form>`:"No active students found in this class.";
      const form=$("#attendanceForm");if(form)form.addEventListener("submit",async e=>{e.preventDefault();const rows=[...new FormData(form).entries()].map(([student_id,status])=>({student_id,class_id:cid,attendance_date:date,status,marked_by:user.id}));const {error}=await db.from("attendance_records").upsert(rows,{onConflict:"student_id,attendance_date"});say("#attendanceMessage",error?"Could not save attendance. Check your class permissions.":"Attendance saved.",!!error);});
    });
    await loadNotices("#teacherNotices","teachers");
  }
  async function parentView(user) {
    $("#dashboardContent").innerHTML='<div class="dashboard-columns"><section class="panel"><h3>My children</h3><div id="childrenList">Loading…</div></section><section class="panel"><h3>Notifications & school notices</h3><div id="parentNotices">Loading…</div></section></div><section class="panel"><h3>Private talent corner</h3><div id="talentList">Loading…</div><p class="subline">Only approved clips are shown to signed-in school families. Do not share links publicly.</p></section>';
    const {data:links,error}=await db.from("parent_students").select("student:students(id,full_name,student_code,class:classes(name))").eq("parent_id",user.id);
    $("#childrenList").innerHTML=error?"Could not load children. Ask the administrator to link your account.":links?.length?links.map(x=>`<div class="child-card"><b>${safe(x.student?.full_name)}</b><span>${safe(x.student?.class?.name||"Class not assigned")}</span><button class="small-btn" data-child="${x.student?.id}">View reports & attendance</button><div id="child-${x.student?.id}"></div></div>`).join(""):"No children linked to this account yet.";
    $("#childrenList").querySelectorAll("[data-child]").forEach(b=>b.addEventListener("click",async()=>{const id=b.dataset.child;const target=$("#child-"+id);const [reports,att]=await Promise.all([db.from("report_cards").select("id,term,academic_year,average,grade,teacher_comment,published").eq("student_id",id).eq("published",true).order("academic_year",{ascending:false}),db.from("attendance_records").select("attendance_date,status").eq("student_id",id).order("attendance_date",{ascending:false}).limit(30)]);target.innerHTML=`<h4>Published reports</h4>${reports.data?.length?reports.data.map(r=>`<div class="report-row">${safe(r.academic_year)} · ${safe(r.term)} · Average: ${safe(r.average)} · Grade: ${safe(r.grade)} ${r.teacher_comment?`<p>${safe(r.teacher_comment)}</p>`:""}<button class="small-btn" onclick="window.print()">Print page</button></div>`).join(""):"No published reports."}<h4>Recent attendance</h4>${att.data?.length?att.data.map(a=>`<p>${safe(a.attendance_date)} — ${safe(a.status)}</p>`).join(""):"No attendance records."}`;}));
    await loadNotices("#parentNotices","parents");
    const {data:t}=await db.from("talent_clips").select("id,title,description,storage_path,created_at").eq("approved",true).order("created_at",{ascending:false});
    $("#talentList").innerHTML=t?.length?t.map(v=>`<div class="talent-row"><b>${safe(v.title)}</b><p>${safe(v.description)}</p><button class="small-btn" data-talent="${safe(v.storage_path)}">Open private clip</button></div>`).join(""):"No approved clips have been published.";
    $("#talentList").querySelectorAll("[data-talent]").forEach(b=>b.addEventListener("click",async()=>{const {data,error}=await db.storage.from("talent-private").createSignedUrl(b.dataset.talent,60);if(error){alert("Could not open clip. Ask the school administrator.");return;}window.open(data.signedUrl,"_blank","noopener");}));
  }
  async function loadNotices(target,audience) {const {data,error}=await db.from("announcements").select("title,body,created_at,audience").in("audience",["all",audience]).order("created_at",{ascending:false}).limit(20);$(target).innerHTML=error?"Could not load notices.":data?.length?data.map(n=>`<article class="notice-item"><b>${safe(n.title)}</b><small>${safe(new Date(n.created_at).toLocaleString())}</small><p>${safe(n.body)}</p></article>`).join(""):"No notices yet.";}
  if(db) db.auth.getSession().then(({data})=>{if(data.session)renderDashboard(data.session.user);});
  if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("service-worker.js").catch(()=>{});
})();