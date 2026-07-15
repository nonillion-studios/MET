// كود البوت المطور بالكامل لإدارة المهام والعمليات المالية والـ 16 ميزة الإضافية للأعضاء والمديرين
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BOT_TOKEN = "8637102040:AAFIsPPl4mKekZSg2HokZhAulMtxR3WyKSI";
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  try {
    const update = await req.json();
    const message = update.message;
    const callbackQuery = update.callback_query;

    // 1. معالجة العمليات التفاعلية لضغطات الأزرار الشفافة
    if (callbackQuery) {
      await handleCallbackQuery(callbackQuery);
      return new Response("OK", { status: 200 });
    }

    if (!message) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const text = message.text || "";
    const fromUser = message.from;
    const userIdStr = fromUser.id.toString();
    const rawUsername = fromUser.username ? fromUser.username.toLowerCase() : "";

    // التحقق والربط التلقائي من وجود المستخدم بقاعدة البيانات
    let { data: currentUser } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', userIdStr)
      .maybeSingle();

    if (!currentUser && rawUsername) {
      const { data: foundByUsername } = await supabase
        .from('users')
        .select('*')
        .or(`username.eq.${rawUsername},username.eq.@${rawUsername}`)
        .maybeSingle();

      if (foundByUsername) {
        await supabase
          .from('users')
          .update({
            telegram_id: userIdStr,
            display_name: fromUser.first_name + (fromUser.last_name ? " " + fromUser.last_name : "")
          })
          .eq('username', foundByUsername.username);

        const { data: updatedUser } = await supabase
          .from('users')
          .select('*')
          .eq('telegram_id', userIdStr)
          .single();
        
        currentUser = updatedUser;
      }
    }

    // أمر البداية والترحيب الذكي
    if (text === "/start") {
      if (!currentUser) {
        await sendMessage(chatId, "❌ عذراً، أنت غير مسجل في قاعدة بيانات الفريق. يرجى الطلب من الإدارة تسجيل حسابك أولاً.");
        return new Response("OK", { status: 200 });
      }

      if (currentUser.status === 'resigned') {
        await sendMessage(chatId, "🚫 تم إنهاء وتجميد حسابك بسبب تقديم الاستقالة مسبقاً.");
        return new Response("OK", { status: 200 });
      }

      if (currentUser.role === 'admin') {
        // إحصائيات الإدارة الشاملة
        const { data: allUsers } = await supabase.from('users').select('job_title');
        let stats = { "مصمم": 0, "مبيض": 0, "مترجم": 0, "محرر": 0, "مدقق": 0, "تلوين": 0 };
        allUsers?.forEach((u: any) => {
          if (u.job_title in stats) {
            stats[u.job_title as keyof typeof stats]++;
          }
        });

        const { count: totalTasks } = await supabase.from('tasks').select('*', { count: 'exact', head: true });

        const welcomeMsg = `👑 أهلاً بك يا مدير: ${currentUser.display_name || fromUser.first_name} (@${fromUser.username || ''})
        
📊 قوى أعضاء الفريق الحاليين:
🎨 المصممون: ${stats["مصمم"]} | 🧹 المبيّضون: ${stats["مبيض"]}
🗣 المترجمون: ${stats["مترجم"]} | ✂️ المحررون: ${stats["محرر"]}
📝 المدققون: ${stats["مدقق"]} | 🖌 الملونون: ${stats["تلوين"]}

📉 إجمالي المهام المنشأة بالفريق: ${totalTasks || 0}

استخدم لوحة التحكم التفاعلية الشاملة أدناه لإدارة الفريق بالكامل:`;

        await sendAdminInlineDashboard(chatId, welcomeMsg);
      } else {
        // لوحة تحكم الأعضاء
        const { count: doneTasks } = await supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', userIdStr)
          .eq('status', 'Completed');

        const { count: activeTasks } = await supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_to', userIdStr)
          .eq('status', 'In_Progress');

        let statusText = "🟢 نشط ومتاح للعمل";
        if (currentUser.status === 'on_leave') statusText = "🟡 في إجازة حالياً";
        else if (!currentUser.is_active) statusText = "🔴 مشغول (تلقي المهام متوقف)";

        const memberMsg = `👋 أهلاً بك يا بطل الفريق: ${currentUser.display_name || fromUser.first_name}
🎭 تخصصك بالفريق: ${currentUser.job_title}
⭐ ترتيب أولويتك: ${currentUser.priority}
💰 رصيدك المالي الحالي: ${currentUser.balance} $
📅 سلسلة الحضور اليومي: ${currentUser.streak_count || 0} أيام متتالية
⚙️ حالتك الحالية بالفريق: ${statusText}

📊 ملخص نشاطك:
✅ المهام المكتملة: ${doneTasks || 0}
⏳ المهام النشطة قيد العمل: ${activeTasks || 0}

تحكم بأعمالك وحسابك المالي وحالتك بالكامل من الأزرار التفاعلية أدناه:`;

        await sendMemberInlineDashboard(chatId, memberMsg, currentUser.is_active, currentUser.status);
      }
      return new Response("OK", { status: 200 });
    }

    if (!currentUser) {
      await sendMessage(chatId, "❌ غير مصرح لك باستخدام البوت. يرجى التواصل مع الإدارة أولاً.");
      return new Response("OK", { status: 200 });
    }

    // التحقق من وجود خطوات معلقة للمستخدم لتلقي المدخلات النصية
    const { data: userState } = await supabase
      .from('user_states')
      .select('*')
      .eq('telegram_id', userIdStr)
      .maybeSingle();

    if (userState) {
      await handleUserStateSteps(chatId, text, message, userState, currentUser);
      return new Response("OK", { status: 200 });
    }

    await sendMessage(chatId, "ℹ️ أرسل /start لعرض لوحة التحكم التفاعلية المباشرة للبوت.");

  } catch (err) {
    console.error("Critical System Error:", err);
  }
  return new Response("OK", { status: 200 });
});

// -------------------------------------------------------------
// محرك الحالات الديناميكية (Dynamic State Machine)
// -------------------------------------------------------------
async function handleUserStateSteps(chatId: any, text: string, message: any, state: any, currentUser: any) {
  const userId = state.telegram_id;
  const temp = state.temp_data || {};

  switch (state.step) {
    // ---- خطوات إنشاء المهام ----
    case 'waiting_for_task_name':
      await supabase.from('user_states').update({
        step: 'waiting_for_file',
        temp_data: { ...temp, name: text }
      }).eq('telegram_id', userId);
      await sendMessage(chatId, "📁 تم حفظ اسم المهمة بنجاح.\nالآن قم بإعادة توجيه أو رفع الملف المطلوب (Document) الخاص بالفصل:");
      break;

    case 'waiting_for_file':
      if (message.document) {
        await supabase.from('user_states').update({
          step: 'waiting_for_deadline',
          temp_data: { ...temp, file_id: message.document.file_id }
        }).eq('telegram_id', userId);
        await sendMessage(chatId, "⏳ ممتاز، تم حفظ ملف المهمة.\nالآن اكتب موعد التسليم النهائي المطلوب (مثال: 2026-08-10):");
      } else {
        await sendMessage(chatId, "❌ يرجى رفع ملف صحيح كـ Document للعمل.");
      }
      break;

    case 'waiting_for_deadline':
      await supabase.from('user_states').update({
        step: 'waiting_for_difficulty',
        temp_data: { ...temp, deadline: text }
      }).eq('telegram_id', userId);
      
      // اختيار مستوى الصعوبة لتحديد المكافأة التلقائية
      const difficultyKeyboard = {
        inline_keyboard: [
          [{ text: "🟢 سهلة (مكافأة تلقائية 5$)", callback_data: "diff_set_Easy" }],
          [{ text: "🟡 متوسطة (مكافأة تلقائية 10$)", callback_data: "diff_set_Medium" }],
          [{ text: "🔴 صعبة (مكافأة تلقائية 20$)", callback_data: "diff_set_Hard" }]
        ]
      };
      await sendMessage(chatId, "🌟 اختر مستوى صعوبة هذه المهمة لتحديد المكافأة المالية التلقائية المخصصة لها عند الإتمام:", difficultyKeyboard);
      break;

    case 'waiting_for_desc':
      await supabase.from('user_states').update({
        step: 'waiting_for_notify',
        temp_data: { ...temp, description: text }
      }).eq('telegram_id', userId);
      await sendNotificationChoiceKeyboard(chatId);
      break;

    // ---- خطوات تسجيل وإضافة الأعضاء الجدد ----
    case 'add_member_user':
      const targetUser = text.replace("@", "").trim().toLowerCase();
      await supabase.from('user_states').update({
        step: 'add_member_team',
        temp_data: { ...temp, username: targetUser }
      }).eq('telegram_id', userId);
      await sendMessage(chatId, "🏢 اكتب الآن اسم الفريق الذي ينتمي إليه العضو (مثال: الفريق الرئيسي):");
      break;

    case 'add_member_team':
      await supabase.from('user_states').update({
        step: 'add_member_job',
        temp_data: { ...temp, team_name: text }
      }).eq('telegram_id', userId);
      await sendJobTitlesSelectionKeyboard(chatId);
      break;

    case 'add_member_priority':
      const prio = parseInt(text);
      if (isNaN(prio) || prio < 1) {
        await sendMessage(chatId, "⚠️ يرجى إدخال قيمة رقمية صحيحة للأولوية (1 أو أكثر):");
        return;
      }

      const finalPriority = await getCollisionFreePriority(temp.job_title, prio);
      const tempId = "temp_" + Math.random().toString(36).substring(7);
      
      const { error: insErr } = await supabase.from('users').insert([{
        telegram_id: tempId,
        username: temp.username,
        display_name: temp.username,
        team_name: temp.team_name,
        job_title: temp.job_title,
        priority: finalPriority,
        balance: 0,
        role: 'member'
      }]);

      await supabase.from('user_states').delete().eq('telegram_id', userId);

      if (insErr) {
        await sendMessage(chatId, "❌ فشل تسجيل العضو، قد يكون مضافاً مسبقاً بقاعدة البيانات.");
      } else {
        await sendMessage(chatId, `✅ تم تسجيل العضو @${temp.username} بنجاح بالوظيفة [${temp.job_title}] وأولوية [${finalPriority}].`);
      }
      break;

    // ---- معالجة تعديل الأعضاء من قبل الأدمن ----
    case 'edit_member_value':
      const memberToEdit = temp.target_user_id;
      const field = temp.field;
      let updateData: any = {};

      if (field === 'priority' || field === 'balance') {
        const val = parseFloat(text);
        if (isNaN(val)) {
          await sendMessage(chatId, "⚠️ يرجى إدخال قيمة رقمية صحيحة للتعديل:");
          return;
        }
        updateData[field] = val;
      } else {
        updateData[field] = text;
      }

      if (field === 'role') {
        await sendMessage(chatId, "🚫 ميزة تعديل وتغيير الرتب معطلة تماماً لضمان حماية الإدارة وصلاحيات الأدمن.");
        await supabase.from('user_states').delete().eq('telegram_id', userId);
        return;
      }

      const { error: editErr } = await supabase.from('users').update(updateData).eq('telegram_id', memberToEdit);
      await supabase.from('user_states').delete().eq('telegram_id', userId);

      if (editErr) {
        await sendMessage(chatId, "❌ فشل تحديث البيانات في قاعدة البيانات.");
      } else {
        await sendMessage(chatId, `✅ تم تعديل حقل [${field}] بنجاح للعضو المختار.`);
      }
      break;

    // ---- تمديد وقت تسليم المهمة الجارية ----
    case 'admin_extend_deadline_val':
      const extendTaskId = temp.task_id;
      await supabase.from('tasks').update({ deadline: text }).eq('id', extendTaskId);
      await supabase.from('user_states').delete().eq('telegram_id', userId);
      await sendMessage(chatId, `✅ تم تمديد وتحديث موعد تسليم المهمة رقم (${extendTaskId}) بنجاح إلى: ${text}`);
      break;

    // ---- طلب الإجازة من العضو ----
    case 'member_leave_reason':
      await supabase.from('user_states').update({
        step: 'member_leave_duration',
        temp_data: { ...temp, reason: text }
      }).eq('telegram_id', userId);
      await sendMessage(chatId, "✍️ حدد مدة الإجازة المطلوبة بالتفصيل (مثال: من تاريخ 2026-07-01 إلى 2026-07-07):");
      break;

    case 'member_leave_duration':
      await supabase.from('leave_requests').insert([{
        telegram_id: userId,
        reason: temp.reason,
        duration: text,
        status: 'Pending'
      }]);
      await supabase.from('user_states').delete().eq('telegram_id', userId);
      await sendMessage(chatId, "⏳ تم إرسال طلب الإجازة بنجاح وهو الآن قيد مراجعة واعتماد الإدارة.");
      await sendAdminAlert(`🚨 العضو @${currentUser.username} قدم طلب إجازة جديد لتاريخ (${text}) بسبب: ${temp.reason}. يرجى مراجعة الطلبات بالفريق.`);
      break;

    // ---- طلب الاستقالة من العضو ----
    case 'member_resignation_reason':
      await supabase.from('resignation_requests').insert([{
        telegram_id: userId,
        reason: text,
        status: 'Pending'
      }]);
      await supabase.from('user_states').delete().eq('telegram_id', userId);
      await sendMessage(chatId, "⏳ تم إرسال طلب استقالتك بنجاح وهو الآن قيد مراجعة الإدارة.");
      await sendAdminAlert(`🚨 العضو @${currentUser.username} قدم طلب استقالة رسمي بسبب: ${text}. يرجى مراجعة الطلبات بالفريق.`);
      break;

    // ---- البنك والعمليات المالية المتقدمة ----
    case 'deposit_amount':
      const depVal = parseFloat(text);
      if (isNaN(depVal) || depVal <= 0) {
        await sendMessage(chatId, "⚠️ اكتب مبلغاً صحيحاً أكبر من الصفر:");
        return;
      }
      await supabase.from('user_states').update({
        step: 'deposit_details',
        temp_data: { ...temp, amount: depVal }
      }).eq('telegram_id', userId);
      await sendMessage(chatId, "✍️ اكتب سبب الإيداع المالي الحالي (لتوثيق المكافأة):");
      break;

    case 'deposit_details':
      const { data: targetUserObj } = await supabase.from('users').select('balance').eq('telegram_id', temp.target_user_id).maybeSingle();
      const newBal = (targetUserObj?.balance || 0) + temp.amount;
      
      await supabase.from('users').update({ balance: newBal }).eq('telegram_id', temp.target_user_id);
      
      await supabase.from('transactions').insert([{
        sender_id: 'system',
        receiver_id: temp.target_user_id,
        amount: temp.amount,
        details: text
      }]);

      await supabase.from('user_states').delete().eq('telegram_id', userId);
      await sendMessage(chatId, `💵 تمت إضافة المكافأة بقيمة ${temp.amount}$ لحساب العضو بنجاح.`);
      await sendMessage(temp.target_user_id, `💰 تم إيداع مكافأة في حسابك بقيمة ${temp.amount}$\nالسبب: ${text}`);
      break;

    case 'send_amount':
      const sAmt = parseFloat(text);
      if (isNaN(sAmt) || sAmt <= 0) {
        await sendMessage(chatId, "⚠️ يرجى إدخال قيمة رقمية صحيحة:");
        return;
      }
      if (currentUser.balance < sAmt && currentUser.role !== 'admin') {
        await sendMessage(chatId, "❌ رصيدك المالي غير كافٍ لإتمام عملية التحويل المالي.");
        await supabase.from('user_states').delete().eq('telegram_id', userId);
        return;
      }
      await supabase.from('user_states').update({
        step: 'send_details',
        temp_data: { ...temp, amount: sAmt }
      }).eq('telegram_id', userId);
      await sendMessage(chatId, "✍️ اكتب الغرض أو الملاحظة المرفقة بطلب التحويل:");
      break;

    case 'send_details':
      const { data: senderObj } = await supabase.from('users').select('balance').eq('telegram_id', userId).maybeSingle();
      const { data: receiverObj } = await supabase.from('users').select('balance').eq('telegram_id', temp.target_user_id).maybeSingle();

      if (senderObj && receiverObj) {
        await supabase.from('users').update({ balance: senderObj.balance - temp.amount }).eq('telegram_id', userId);
        await supabase.from('users').update({ balance: receiverObj.balance + temp.amount }).eq('telegram_id', temp.target_user_id);

        await supabase.from('transactions').insert([{
          sender_id: userId,
          receiver_id: temp.target_user_id,
          amount: temp.amount,
          details: text
        }]);

        await sendMessage(chatId, `💸 تم تحويل مبلغ ${temp.amount}$ بنجاح للعضو المختار.`);
        await sendMessage(temp.target_user_id, `📥 استلمت تحويلاً مالياً بقيمة ${temp.amount}$ من الزميل @${currentUser.username || 'مجهول'}\nالسبب: ${text}`);
      } else {
        await sendMessage(chatId, "❌ حدث خطأ غير متوقع أثناء عملية التحويل المالي.");
      }
      await supabase.from('user_states').delete().eq('telegram_id', userId);
      break;

    // ---- نظام الخصم والمخالفات المالي للأدمن ----
    case 'penalty_amount':
      const penAmt = parseFloat(text);
      if (isNaN(penAmt) || penAmt <= 0) {
        await sendMessage(chatId, "⚠️ يرجى إدخال قيمة الخصم بالأرقام:");
        return;
      }
      await supabase.from('user_states').update({
        step: 'penalty_details',
        temp_data: { ...temp, amount: penAmt }
      }).eq('telegram_id', userId);
      await sendMessage(chatId, "✍️ اكتب سبب المخالفة والخصم ليتم إرساله للعضو وتوثيقه:");
      break;

    case 'penalty_details':
      const { data: penalizedUser } = await supabase.from('users').select('balance').eq('telegram_id', temp.target_user_id).maybeSingle();
      if (penalizedUser) {
        const afterPenaltyBal = (penalizedUser.balance || 0) - temp.amount;
        await supabase.from('users').update({ balance: afterPenaltyBal }).eq('telegram_id', temp.target_user_id);
        
        await supabase.from('transactions').insert([{
          sender_id: 'system_penalty',
          receiver_id: temp.target_user_id,
          amount: -temp.amount,
          details: text
        }]);

        await sendMessage(chatId, `📉 تم خصم ${temp.amount}$ وتطبيق المخالفة بنجاح على الحساب.`);
        await sendMessage(temp.target_user_id, `🚨 تم تسجيل مخالفة وخصم مالي من حسابك بقيمة: -${temp.amount}$\nالسبب: ${text}`);
      }
      await supabase.from('user_states').delete().eq('telegram_id', userId);
      break;

    // ---- سحب الأموال للعضو مع التعليق الآمن ----
    case 'member_withdraw_amount':
      const wAmt = parseFloat(text);
      if (isNaN(wAmt) || wAmt <= 0) {
        await sendMessage(chatId, "⚠️ يرجى إدخال مبلغ صحيح:");
        return;
      }
      if (currentUser.balance < wAmt) {
        await sendMessage(chatId, "❌ عذراً، لا تمتلك هذا الرصيد الكافي للسحب حالياً.");
        await supabase.from('user_states').delete().eq('telegram_id', userId);
        return;
      }

      await supabase.from('users').update({ balance: currentUser.balance - wAmt }).eq('telegram_id', userId);
      await supabase.from('withdrawals').insert([{
        telegram_id: userId,
        amount: wAmt,
        status: 'Pending'
      }]);

      await supabase.from('user_states').delete().eq('telegram_id', userId);
      await sendMessage(chatId, `⏳ تم خصم ${wAmt}$ من رصيدك وتعليقها بنجاح بانتظار موافقة وتحويل الإدارة للمبلغ.`);
      await sendAdminAlert(`⚠️ العضو @${currentUser.username} قدم طلب سحب نقدي معلق بمقدار ${wAmt}$. يرجى مراجعة الطلبات المعلقة في الإدارة.`);
      break;

    // ---- تغيير العضو لأولويته الخاصة لمنع الصدامات ----
    case 'member_change_priority':
      const newPrio = parseInt(text);
      if (isNaN(newPrio) || newPrio < 1) {
        await sendMessage(chatId, "⚠️ يرجى إدخال أولوية رقمية صحيحة:");
        return;
      }

      const safePrio = await getCollisionFreePriority(currentUser.job_title, newPrio);
      await supabase.from('users').update({ priority: safePrio }).eq('telegram_id', userId);
      await supabase.from('user_states').delete().eq('telegram_id', userId);

      await sendMessage(chatId, `⭐ تم تعديل ترتيب أولويتك للرقم المعتمد: ${safePrio} ${safePrio !== newPrio ? "(تم الترحيل التلقائي لمنع تصادم الأدوار بالفريق)" : ""}`);
      break;

    // ---- معالجة رفض التسليم وإعادة الملاحظات للعضو للتعديل ----
    case 'admin_reject_sub_notes':
      const rejectTaskId = temp.task_id;
      const { data: rejectedTaskObj } = await supabase.from('tasks').select('*').eq('id', rejectTaskId).maybeSingle();
      
      if (rejectedTaskObj) {
        await supabase.from('tasks').update({ status: 'In_Progress' }).eq('id', rejectTaskId);
        await sendMessage(rejectedTaskObj.assigned_to, `⚠️ تم مراجعة عملك الأخير للفصل "${rejectedTaskObj.task_name}" من قبل الإدارة وتم رفضه لإجراء التعديلات التالية:\n\n💬 ملاحظات الإدارة:\n${text}`);
        await sendMessage(chatId, "✅ تم إرجاع المهمة للعضو وإبلاغه بملاحظات التعديل والرفض بنجاح.");
      }
      await supabase.from('user_states').delete().eq('telegram_id', userId);
      break;

    // ---- تسليم المهام عن طريق الملفات والروابط ----
    case 'submit_task_file':
      if (message.document || message.photo) {
        const subFileId = message.document ? message.document.file_id : message.photo[message.photo.length - 1].file_id;
        const subTaskId = temp.task_id;

        await supabase.from('tasks').update({
          status: 'Under_Review',
          submission_type: 'file',
          submission_content: subFileId
        }).eq('id', subTaskId);

        await supabase.from('user_states').delete().eq('telegram_id', userId);
        await sendMessage(chatId, "✅ تم رفع وتسليم الملف المكتمل بنجاح للمراجعة الإدارية!");
        await sendSubmissionReviewAlert(subTaskId, 'ملف مرفق', subFileId, currentUser.username);
      } else {
        await sendMessage(chatId, "❌ يرجى رفع ملف صحيح كـ Document أو صورة للعمل لتسليم المهمة:");
      }
      break;

    case 'submit_task_link':
      if (text.startsWith("http://") || text.startsWith("https://")) {
        const subTaskId = temp.task_id;

        await supabase.from('tasks').update({
          status: 'Under_Review',
          submission_type: 'link',
          submission_content: text
        }).eq('id', subTaskId);

        await supabase.from('user_states').delete().eq('telegram_id', userId);
        await sendMessage(chatId, "✅ تم حفظ رابط التسليم بنجاح للمراجعة الإدارية المباشرة!");
        await sendSubmissionReviewAlert(subTaskId, 'رابط تسليم خارجي', text, currentUser.username);
      } else {
        await sendMessage(chatId, "❌ يرجى إرسال رابط صحيح يبدأ بـ http أو https لتقديمه:");
      }
      break;

    // ---- إرسال إشعار وبث جماعي للفريق ----
    case 'admin_broadcast_text':
      const { data: teamUsers } = await supabase.from('users').select('telegram_id');
      await supabase.from('user_states').delete().eq('telegram_id', userId);

      teamUsers?.forEach(async (u: any) => {
        await sendMessage(u.telegram_id, `📢 إعلان إداري جماعي هام من الإدارة:\n\n${text}`);
      });
      await sendMessage(chatId, "✅ تم إرسال وبث الإشعار الجماعي لكافة أعضاء التيم بنجاح.");
      break;
  }
}

// -------------------------------------------------------------
// محرك ضغطات الأزرار الشفافة التفاعلية (Callback Query Handler)
// -------------------------------------------------------------
async function handleCallbackQuery(callbackQuery: any) {
  const chatId = callbackQuery.message.chat.id;
  const messageId = callbackQuery.message.message_id;
  const data = callbackQuery.data;
  const userId = callbackQuery.from.id.toString();

  const { data: user } = await supabase.from('users').select('*').eq('telegram_id', userId).maybeSingle();
  if (!user) return;

  const { data: state } = await supabase.from('user_states').select('*').eq('telegram_id', userId).maybeSingle();

  // --- لوحة التحكم والعمليات للأدمن ---
  if (data === "admin_new_task") {
    await supabase.from('user_states').upsert({ telegram_id: userId, step: 'waiting_for_task_name', temp_data: {} });
    await sendMessage(chatId, "✍️ اكتب الآن اسم المهمة/الفصل:");
    return;
  }
  if (data === "admin_add_member") {
    await supabase.from('user_states').upsert({ telegram_id: userId, step: 'add_member_user', temp_data: {} });
    await sendMessage(chatId, "👤 اكتب يوزر تيليجرام الخاص بالعضو الجديد (مثال: @username):");
    return;
  }
  
  // شاشة تعديل بيانات الأعضاء التفصيلية
  if (data === "admin_edit_member_menu") {
    const { data: members } = await supabase.from('users').select('telegram_id, username, display_name');
    let inlineKb = [];
    members?.forEach((m: any) => {
      inlineKb.push([{ text: `${m.display_name} (${m.username})`, callback_data: `edit_select_${m.telegram_id}` }]);
    });
    await sendMessage(chatId, "📝 اختر العضو الذي ترغب في تعديل بياناته وقيم حسابه:", { inline_keyboard: inlineKb });
    return;
  }
  if (data.startsWith("edit_select_")) {
    const targetId = data.replace("edit_select_", "");
    const keyboard = {
      inline_keyboard: [
        [{ text: "اسم العرض", callback_data: `edit_field_${targetId}_display_name` }, { text: "اليوزرنيم", callback_data: `edit_field_${targetId}_username` }],
        [{ text: "الرصيد المالي", callback_data: `edit_field_${targetId}_balance` }, { text: "الأولوية", callback_data: `edit_field_${targetId}_priority` }],
        [{ text: "الوظيفة", callback_data: `edit_field_${targetId}_job_title` }]
      ]
    };
    await editMessageReplyMarkup(chatId, messageId, keyboard);
    return;
  }
  if (data.startsWith("edit_field_")) {
    const parts = data.split("_");
    const targetId = parts[2];
    const field = parts.slice(3).join("_");

    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'edit_value',
      temp_data: { target_user_id: targetId, field: field }
    });

    if (field === 'job_title') {
      const keyboard = {
        inline_keyboard: [
          [{ text: "تبييض", callback_data: `job_val_${targetId}_تبييض` }, { text: "ترجمة", callback_data: `job_val_${targetId}_ترجمة` }],
          [{ text: "تحرير", callback_data: `job_val_${targetId}_تحرير` }, { text: "تدقيق", callback_data: `job_val_${targetId}_تدقيق` }],
          [{ text: "تلوين", callback_data: `job_val_${targetId}_تلوين` }, { text: "تصميم", callback_data: `job_val_${targetId}_تصميم` }]
        ]
      };
      await sendMessage(chatId, "⚙️ اختر الوظيفة الجديدة للعضو المختار:", keyboard);
    } else {
      await supabase.from('user_states').update({ step: 'edit_member_value' }).eq('telegram_id', userId);
      await sendMessage(chatId, `✍️ اكتب الآن القيمة الجديدة لحقل [${field}]:`);
    }
    return;
  }
  if (data.startsWith("job_val_")) {
    const parts = data.split("_");
    const targetId = parts[2];
    const newJob = parts[3];

    await supabase.from('users').update({ job_title: newJob }).eq('telegram_id', targetId);
    await supabase.from('user_states').delete().eq('telegram_id', userId);
    await sendMessage(chatId, `✅ تم تحديث الوظيفة للعضو بنجاح إلى: ${newJob}`);
    return;
  }

  // --- نظام فحص ومراقبة إنتاجية العضو بالفترات الزمنية ---
  if (data === "admin_member_stats") {
    const { data: members } = await supabase.from('users').select('telegram_id, username, display_name');
    let inlineKb = [];
    members?.forEach((m: any) => {
      inlineKb.push([{ text: `📊 إنتاجية: ${m.display_name}`, callback_data: `m_stat_sel_${m.telegram_id}` }]);
    });
    await sendMessage(chatId, "📊 حدد العضو الذي ترغب في فحص إحصائيات إنتاجه وأعماله بالتفصيل:", { inline_keyboard: inlineKb });
    return;
  }
  if (data.startsWith("m_stat_sel_")) {
    const targetId = data.replace("m_stat_sel_", "");
    const keyboard = {
      inline_keyboard: [
        [{ text: "📅 آخر 7 أيام", callback_data: `m_stat_calc_${targetId}_7` }],
        [{ text: "📆 آخر 30 يوماً", callback_data: `m_stat_calc_${targetId}_30` }],
        [{ text: "♾️ إجمالي الأعمال", callback_data: `m_stat_calc_${targetId}_all` }]
      ]
    };
    await editMessageReplyMarkup(chatId, messageId, keyboard);
    return;
  }
  if (data.startsWith("m_stat_calc_")) {
    const parts = data.split("_");
    const targetId = parts[3];
    const period = parts[4]; 

    const { data: targetUser } = await supabase.from('users').select('*').eq('telegram_id', targetId).single();
    if (!targetUser) return;

    let query = supabase.from('tasks').select('*').eq('assigned_to', targetId).eq('status', 'Completed');

    if (period !== 'all') {
      const days = parseInt(period);
      const dateLimit = new Date();
      dateLimit.setDate(dateLimit.getDate() - days);
      query = query.gte('completed_at', dateLimit.toISOString());
    }

    const { data: completedTasks } = await query;
    let statsMsg = `📊 تقرير إنتاجية العضو @${targetUser.username}:\n👤 الاسم الفعلي: ${targetUser.display_name}\n🎭 الوظيفة: ${targetUser.job_title}\n\n`;
    
    if (period === 'all') {
      statsMsg += `🕒 الفترة الزمنية: إجمالي الإنتاج الكلي للفريق\n`;
    } else {
      statsMsg += `🕒 الفترة الزمنية: آخر ${period} يوماً المنصرمة\n`;
    }

    statsMsg += `✅ إجمالي المهام المنجزة والمعتمدة: ${completedTasks?.length || 0}\n\n`;
    
    if (completedTasks && completedTasks.length > 0) {
      statsMsg += `📝 سجل أعماله المنجزة في هذه الفترة:\n`;
      completedTasks.forEach((t: any, idx: number) => {
        statsMsg += `${idx + 1}. "${t.task_name}" [⭐ جودة العمل: ${t.rating || 0} نجوم]\n`;
      });
    } else {
      statsMsg += `📭 لم يتم تسجيل أو اعتماد تسليم أي مهام في هذه الفترة الزمنية المحددة.`;
    }

    await sendMessage(chatId, statsMsg);
    return;
  }

  // --- سحب السحوبات المالية المعلقة للأدمن ---
  if (data === "admin_withdrawals") {
    const { data: list } = await supabase.from('withdrawals').select('*, users(username, display_name)').eq('status', 'Pending');
    if (!list || list.length === 0) {
      await sendMessage(chatId, "📥 لا توجد طلبات سحب نقود معلقة في الخزينة حالياً.");
      return;
    }
    list.forEach(async (w: any) => {
      const msg = `💰 طلب سحب مالي معلق بالانتظار:\n👤 العضو: ${w.users?.display_name} (@${w.users?.username})\n💵 المبلغ: ${w.amount}$`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ موافقة ودفع المبلغ", callback_data: `w_approve_${w.id}` },
            { text: "❌ رفض وإعادة الأموال", callback_data: `w_reject_${w.id}` }
          ]
        ]
      };
      await sendMessage(chatId, msg, keyboard);
    });
    return;
  }
  if (data.startsWith("w_approve_") || data.startsWith("w_reject_")) {
    const wId = data.split("_")[2];
    const { data: request } = await supabase.from('withdrawals').select('*').eq('id', wId).single();

    if (request && request.status === 'Pending') {
      if (data.startsWith("w_approve_")) {
        await supabase.from('withdrawals').update({ status: 'Approved' }).eq('id', wId);
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, "✅ تم تأكيد صرف طلب السحب المالي بنجاح.");
        await sendMessage(request.telegram_id, `✅ تمت الموافقة على طلب سحب الأموال الخاص بك لمبلغ ${request.amount}$ وصرفها لك بنجاح.`);
      } else {
        const { data: userObj } = await supabase.from('users').select('balance').eq('telegram_id', request.telegram_id).single();
        await supabase.from('users').update({ balance: userObj.balance + request.amount }).eq('telegram_id', request.telegram_id);
        await supabase.from('withdrawals').update({ status: 'Rejected' }).eq('id', wId);

        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, "❌ تم رفض طلب السحب ورصيد النقود أُعيد لحساب العضو بنجاح.");
        await sendMessage(request.telegram_id, `❌ تم رفض طلب السحب الخاص بك لمبلغ ${request.amount}$ وإعادة الرصيد بالكامل لحسابك.`);
      }
    }
    return;
  }

  // --- تمديد موعد تسليم المهام للأدمن ---
  if (data.startsWith("extend_dl_")) {
    const taskId = data.replace("extend_dl_", "");
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'admin_extend_deadline_val',
      temp_data: { task_id: taskId }
    });
    await sendMessage(chatId, "⏳ اكتب الموعد النهائي الجديد لتسليم هذه المهمة (مثال: 2026-08-01):");
    return;
  }

  // --- التحويل اليدوي للمهمة لعضو آخر ---
  if (data.startsWith("reassign_task_")) {
    const taskId = data.replace("reassign_task_", "");
    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (!task) return;

    const primaryJob = task.job_types?.split(",")[0] || "مبيض";
    const { data: members } = await supabase.from('users').select('telegram_id, username, display_name').eq('job_title', primaryJob);
    
    let inlineKb: any[] = [];
    members?.forEach((m: any) => {
      inlineKb.push([{ text: `Reassign ➡️ ${m.display_name}`, callback_data: `reassign_do_${taskId}_${m.telegram_id}` }]);
    });
    await sendMessage(chatId, `🛠️ اختر العضو البديل لتخصيص ونقل المهمة رقم (${taskId}) له مباشرة:`, { inline_keyboard: inlineKb });
    return;
  }
  if (data.startsWith("reassign_do_")) {
    const parts = data.split("_");
    const taskId = parts[2];
    const targetMemberId = parts[3];

    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
    if (task) {
      await supabase.from('tasks').update({ assigned_to: targetMemberId, status: 'Pending' }).eq('id', taskId);
      await sendMessage(chatId, "✅ تم إعادة تحويل المهمة وتكليف العضو المختار بها بنجاح.");
      await sendTaskOfferToMember(targetMemberId, { ...task, assigned_to: targetMemberId });
    }
    return;
  }

  // --- نظام إلغاء وحذف المهام للأدمن ---
  if (data.startsWith("cancel_task_")) {
    const taskId = data.replace("cancel_task_", "");
    await supabase.from('tasks').update({ status: 'Cancelled' }).eq('id', taskId);
    await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
    await sendMessage(chatId, `🗑️ تم إلغاء المهمة رقم (${taskId}) بنجاح وتحويل حالتها إلى ملغية.`);
    return;
  }

  // --- نظام الإرسال البث الجماعي ---
  if (data === "admin_broadcast") {
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'admin_broadcast_text',
      temp_data: {}
    });
    await sendMessage(chatId, "📢 اكتب رسالة البث التي ترغب بإرسالها لكافة أعضاء التيم:");
    return;
  }

  // --- لوحة تصدارة ومنافسة الأعضاء ---
  if (data === "member_leaderboard" || data === "admin_leaderboard") {
    const { data: members } = await supabase.from('users').select('*').order('balance', { ascending: false }).limit(5);
    let msg = "🏆 لوحة الصدارة لأبطال التيم (الأعلى رصيداً وإنتاجية):\n\n";
    members?.forEach((m: any, idx: number) => {
      msg += `${idx + 1}. 🥇 @${m.username || 'لا يوجد'} - الرصيد المالي: ${m.balance}$ [${m.job_title}]\n`;
    });
    await sendMessage(chatId, msg);
    return;
  }

  // --- كشف المهام المتأخرة بالوقت ---
  if (data === "admin_overdue_tasks") {
    const { data: list } = await supabase.from('tasks').select('*').neq('status', 'Completed').neq('status', 'Cancelled');
    let overdueMsg = "🚨 المهام المتأخرة التي تجاوزت تاريخ التسليم المقدر:\n\n";
    let count = 0;

    const now = new Date();
    list?.forEach((t: any) => {
      const deadlineDate = new Date(t.deadline);
      if (!isNaN(deadlineDate.getTime()) && deadlineDate < now) {
        overdueMsg += `📌 المهمة: "${t.task_name}"\n⏳ الموعد كان: ${t.deadline}\n📊 الحالة الحالية: ${t.status}\n------------------\n`;
        count++;
      }
    });

    if (count === 0) {
      overdueMsg += "🎉 ممتاز! لا توجد حالياً أي مهام متأخرة عن الموعد المحدد.";
    }
    await sendMessage(chatId, overdueMsg);
    return;
  }

  // --- نظام مراجعة الإجازات المعلقة للأدمن ---
  if (data === "admin_leave_requests") {
    const { data: list } = await supabase.from('leave_requests').select('*, users(username, display_name)').eq('status', 'Pending');
    if (!list || list.length === 0) {
      await sendMessage(chatId, "🏖️ لا توجد طلبات إجازة معلقة حالياً.");
      return;
    }
    list.forEach(async (l: any) => {
      const leaveMsg = `🏖️ طلب إجازة معلق:\n👤 العضو: ${l.users?.display_name} (@${l.users?.username})\n📅 المدة: ${l.duration}\n📝 السبب: ${l.reason}`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ موافقة وتفعيل الإجازة", callback_data: `leave_approve_${l.id}` },
            { text: "❌ رفض طلب الإجازة", callback_data: `leave_reject_${l.id}` }
          ]
        ]
      };
      await sendMessage(chatId, leaveMsg, keyboard);
    });
    return;
  }
  if (data.startsWith("leave_approve_") || data.startsWith("leave_reject_")) {
    const requestId = data.split("_")[2];
    const { data: request } = await supabase.from('leave_requests').select('*').eq('id', requestId).single();

    if (request && request.status === 'Pending') {
      if (data.startsWith("leave_approve_")) {
        await supabase.from('leave_requests').update({ status: 'Approved' }).eq('id', requestId);
        await supabase.from('users').update({ status: 'on_leave' }).eq('telegram_id', request.telegram_id);
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, "✅ تم قبول طلب الإجازة وتحويل حالة العضو بنجاح.");
        await sendMessage(request.telegram_id, `✅ وافقت الإدارة على طلب الإجازة الخاص بك لـ (${request.duration}). نتمنى لك إجازة سعيدة!`);
      } else {
        await supabase.from('leave_requests').update({ status: 'Rejected' }).eq('id', requestId);
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, "❌ تم رفض طلب الإجازة بنجاح.");
        await sendMessage(request.telegram_id, "❌ عذراً، رفضت الإدارة طلب إجازتك الحالي.");
      }
    }
    return;
  }

  // --- نظام مراجعة الاستقالات المعلقة للأدمن ---
  if (data === "admin_resignation_requests") {
    const { data: list } = await supabase.from('resignation_requests').select('*, users(username, display_name)').eq('status', 'Pending');
    if (!list || list.length === 0) {
      await sendMessage(chatId, "🚫 لا توجد طلبات استقالة معلقة حالياً.");
      return;
    }
    list.forEach(async (r: any) => {
      const resMsg = `🚫 طلب استقالة معلق:\n👤 العضو: ${r.users?.display_name} (@${r.users?.username})\n📝 السبب: ${r.reason}`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: "✅ قبول وتجميد الحساب", callback_data: `resig_approve_${r.id}` },
            { text: "❌ رفض وتثبيت العضو", callback_data: `resig_reject_${r.id}` }
          ]
        ]
      };
      await sendMessage(chatId, resMsg, keyboard);
    });
    return;
  }
  if (data.startsWith("resig_approve_") || data.startsWith("resig_reject_")) {
    const requestId = data.split("_")[2];
    const { data: request } = await supabase.from('resignation_requests').select('*').eq('id', requestId).single();

    if (request && request.status === 'Pending') {
      if (data.startsWith("resig_approve_")) {
        await supabase.from('resignation_requests').update({ status: 'Approved' }).eq('id', requestId);
        await supabase.from('users').update({ status: 'resigned' }).eq('telegram_id', request.telegram_id);
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, "✅ تم قبول الاستقالة وتجميد حساب العضو بنجاح.");
        await sendMessage(request.telegram_id, "🚫 تمت الموافقة على استقالتك وتجميد حسابك بالفريق. شكراً لك على خدماتك مسبقاً.");
      } else {
        await supabase.from('resignation_requests').update({ status: 'Rejected' }).eq('id', requestId);
        await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
        await sendMessage(chatId, "❌ تم رفض طلب الاستقالة بنجاح.");
        await sendMessage(request.telegram_id, "❤️ رفضت الإدارة استقالتك وترغب في بقائك بالفريق.");
      }
    }
    return;
  }

  if (data === "admin_view_tasks") {
    await sendTasksOverviewKeyboard(chatId);
    return;
  }
  if (data === "admin_bank") {
    await sendBankKeyboard(chatId);
    return;
  }
  if (data === "admin_stats") {
    await showStatsReports(chatId);
    return;
  }

  // --- لوحة وعمليات العضو الشفافة ---
  if (data === "member_tasks") {
    await showMemberTasks(chatId, userId);
    return;
  }
  if (data === "member_bank") {
    const keyboard = {
      inline_keyboard: [
        [{ text: "💵 تحويل لزميل بالتيم", callback_data: "bank_send" }],
        [{ text: "📥 طلب سحب أموال معلق", callback_data: "member_withdraw" }]
      ]
    };
    await sendMessage(chatId, `💰 رصيدك المالي الحالي: ${user.balance} $`, keyboard);
    return;
  }
  if (data === "member_withdraw") {
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'member_withdraw_amount',
      temp_data: {}
    });
    await sendMessage(chatId, "💵 اكتب قيمة المبلغ الذي ترغب في سحبه (بالأرقام):");
    return;
  }
  if (data === "member_priority_menu") {
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'member_change_priority',
      temp_data: {}
    });
    await sendMessage(chatId, "⭐ اكتب رقم الأولوية الجديد لعملك بالفريق:");
    return;
  }

  // نظام تفعيل أو إيقاف استقبال المهام للعضو
  if (data.startsWith("member_toggle_active_")) {
    const newStatus = data.replace("member_toggle_active_", "") === "true";
    await supabase.from('users').update({ is_active: newStatus }).eq('telegram_id', userId);
    await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
    await sendMessage(chatId, `⚙️ تم تحديث حالتك بنجاح لتصبح: ${newStatus ? "🟢 متاح لتلقي المهام الجديدة" : "🔴 مشغول (تلقي المهام متوقف مؤقتاً)"}`);
    return;
  }

  // طلبات الإجازة والاستقالة للأعضاء
  if (data === "member_leave_menu") {
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'member_leave_reason',
      temp_data: {}
    });
    await sendMessage(chatId, "🏖️ اكتب سبب طلب الإجازة بالتفصيل:");
    return;
  }
  if (data === "member_resign_menu") {
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'member_resignation_reason',
      temp_data: {}
    });
    await sendMessage(chatId, "🚫 اكتب سبب تقديم الاستقالة بالتفصيل:");
    return;
  }

  // تسجيل الحضور اليومي للعضو (سلسلة نشاط)
  if (data === "member_check_in") {
    const now = new Date();
    const lastCheckIn = user.last_check_in ? new Date(user.last_check_in) : null;
    let newStreak = 1;

    if (lastCheckIn) {
      const diffTime = Math.abs(now.getTime() - lastCheckIn.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        newStreak = (user.streak_count || 0) + 1;
      } else if (diffDays > 1) {
        newStreak = 1; // تصفير السلسلة عند الانقطاع
      } else {
        await sendMessage(chatId, "🕒 قمت بتسجيل حضورك اليوم مسبقاً! عد غداً لتسجيل الحضور والحفاظ على السلسلة.");
        return;
      }
    }

    await supabase.from('users').update({
      last_check_in: now.toISOString(),
      streak_count: newStreak
    }).eq('telegram_id', userId);

    await sendMessage(chatId, `🟢 تم تسجيل حضورك لليوم بنجاح!\n🔥 سلسلة حضورك المتتالي الحالية: ${newStreak} أيام متتالية.`);
    return;
  }

  // معالجة اختيار مستوى صعوبة المهمة للأدمن
  if (data.startsWith("diff_set_")) {
    const diffSelected = data.replace("diff_set_", "");
    await supabase.from('user_states').update({
      step: 'waiting_for_jobs',
      temp_data: { ...state.temp_data, difficulty: diffSelected }
    }).eq('telegram_id', userId);
    
    await sendJobTypeSelectionKeyboard(chatId);
    return;
  }

  // معالجة تخصصات المهام
  if (state?.step === 'waiting_for_jobs') {
    if (data.startsWith("job_select_")) {
      const selectedJob = data.replace("job_select_", "");
      const currentJobs = state.temp_data.job_types ? state.temp_data.job_types.split(",") : [];
      
      let updatedJobs = [...currentJobs];
      if (updatedJobs.includes(selectedJob)) {
        updatedJobs = updatedJobs.filter(j => j !== selectedJob);
      } else {
        updatedJobs.push(selectedJob);
      }

      const jobTypesString = updatedJobs.join(",");

      await supabase.from('user_states').update({
        temp_data: { ...state.temp_data, job_types: jobTypesString }
      }).eq('telegram_id', userId);

      await editMessageReplyMarkup(chatId, messageId, await generateJobSelectorKeyboard(updatedJobs));
    } 
    else if (data === "jobs_done") {
      await supabase.from('user_states').update({ step: 'waiting_for_desc' }).eq('telegram_id', userId);
      await sendMessage(chatId, "📝 اكتب الآن رسالة تنبيه أو ملاحظات ترفق مع المهمة:");
    }
    return;
  }

  // معالجة إرسال إشعار عام بعد تأسيس المهمة بنجاح
  if (state?.step === 'waiting_for_notify') {
    const notifyChoice = data === "notify_yes";
    const taskData = state.temp_data;
    const primaryJob = taskData.job_types ? taskData.job_types.split(",")[0] : "مبيض";

    const { data: candidates } = await supabase
      .from('users')
      .select('*')
      .eq('job_title', primaryJob)
      .eq('priority', 1)
      .eq('is_active', true)
      .eq('status', 'active');

    const candidate = candidates && candidates.length > 0 ? candidates[0] : null;

    const { data: insertedTask, error: taskErr } = await supabase.from('tasks').insert([{
      task_name: taskData.name,
      file_id: taskData.file_id,
      deadline: taskData.deadline,
      job_types: taskData.job_types,
      description: taskData.description,
      difficulty: taskData.difficulty || 'Medium',
      status: 'Pending',
      assigned_to: candidate ? candidate.telegram_id : null,
      current_priority_index: 1
    }]).select().single();

    await supabase.from('user_states').delete().eq('telegram_id', userId);

    if (taskErr) {
      await sendMessage(chatId, "❌ فشل حفظ تفاصيل المهمة على خادم قاعدة البيانات.");
      return;
    }

    await sendMessage(chatId, `🎉 تم إنشاء وتوزيع المهمة بنجاح!\nالمرشح الأول للعمل: ${candidate ? candidate.display_name : 'لا يوجد عضو متاح بالأولوية 1 حالياً (مشغولون أو في إجازة)'}`);

    if (candidate) {
      await sendTaskOfferToMember(candidate.telegram_id, insertedTask);
    }

    if (notifyChoice) {
      const { data: teamMembers } = await supabase.from('users').select('telegram_id').neq('role', 'admin');
      teamMembers?.forEach(async (member: any) => {
        if (member.telegram_id !== candidate?.telegram_id) {
          await sendMessage(member.telegram_id, `📢 مهمة تيم مانجا جديدة معلقة تهم تخصصك: "${taskData.name}"`);
        }
      });
    }
    return;
  }

  if (state?.step === 'add_member_job' && data.startsWith("title_select_")) {
    const selectedTitle = data.replace("title_select_", "");
    await supabase.from('user_states').update({
      step: 'add_member_priority',
      temp_data: { ...state.temp_data, job_title: selectedTitle }
    }).eq('telegram_id', userId);
    await sendMessage(chatId, "⭐ اكتب أولوية عمل العضو بالأرقام (مثال: 1):");
    return;
  }

  // قبول أو رفض العضو للمهمة الموكلة له
  if (data.startsWith("accept_task_") || data.startsWith("reject_task_")) {
    const taskId = data.split("_")[2];
    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();

    if (!task || task.status !== 'Pending') {
      await sendMessage(chatId, "⚠️ عذراً، لم تعد هذه المهمة متوفرة للعمل حالياً.");
      return;
    }

    if (data.startsWith("accept_task_")) {
      const { count: activeCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('assigned_to', userId)
        .eq('status', 'In_Progress');

      if (activeCount && activeCount >= 3) {
        await sendMessage(chatId, "❌ عذراً، بلغت الحد الأقصى للمهام الجارية المسموحة لك في آن واحد (3 مهام).");
        return;
      }

      await supabase.from('tasks').update({ status: 'In_Progress', assigned_to: userId }).eq('id', taskId);
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await sendMessage(chatId, `🛠️ قمت بقبول المهمة "${task.task_name}". لقد باشرت العمل عليها بنجاح.`);
      await sendAdminAlert(`⚙️ العضو @${user.username} باشر العمل على مهمة "${task.task_name}".`);
    } else {
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await sendMessage(chatId, "⚠️ تم رفض وتمرير المهمة بنجاح للأولوية التالية.");
      await routeTaskToNextPriority(task);
    }
    return;
  }

  // تسليم مهمة قيد العمل
  if (data.startsWith("submit_task_")) {
    const taskId = data.replace("submit_task_", "");
    const keyboard = {
      inline_keyboard: [
        [{ text: "📂 رفع ملف/صورة", callback_data: `sub_type_file_${taskId}` }],
        [{ text: "🔗 إرسال رابط تسليم", callback_data: `sub_type_link_${taskId}` }]
      ]
    };
    await editMessageReplyMarkup(chatId, messageId, keyboard);
    return;
  }
  if (data.startsWith("sub_type_file_")) {
    const taskId = data.replace("sub_type_file_", "");
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'submit_task_file',
      temp_data: { task_id: taskId }
    });
    await sendMessage(chatId, "📂 قم بتحميل أو رفع ملف التسليم النهائي (Document) هنا للبوت مباشرة:");
    return;
  }
  if (data.startsWith("sub_type_link_")) {
    const taskId = data.replace("sub_type_link_", "");
    await supabase.from('user_states').upsert({
      telegram_id: userId,
      step: 'submit_task_link',
      temp_data: { task_id: taskId }
    });
    await sendMessage(chatId, "🔗 أرسل رابط التسليم المباشر (Drive, Mega...):");
    return;
  }

  // موافقة المدراء للملفات والروابط المسلمة (مع مكافأة مالية تلقائية حسب الصعوبة)
  if (data.startsWith("approve_task_") || data.startsWith("reject_sub_")) {
    const taskId = data.split("_")[2];
    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();

    if (!task) return;

    if (data.startsWith("approve_task_")) {
      const keyboard = {
        inline_keyboard: [
          [
            { text: "⭐ 1", callback_data: `rate_do_${taskId}_1` },
            { text: "⭐⭐ 2", callback_data: `rate_do_${taskId}_2` },
            { text: "⭐⭐⭐ 3", callback_data: `rate_do_${taskId}_3` }
          ],
          [
            { text: "⭐⭐⭐⭐ 4", callback_data: `rate_do_${taskId}_4` },
            { text: "⭐⭐⭐⭐⭐ 5", callback_data: `rate_do_${taskId}_5` }
          ]
        ]
      };
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await sendMessage(chatId, "🌟 الرجاء تحديد تقييم جودة تسليم هذا العمل لاعتماد المهمة نهائياً وصرف مكافأتها التلقائية للعضو:", keyboard);
    } else {
      await supabase.from('user_states').upsert({
        telegram_id: userId,
        step: 'admin_reject_sub_notes',
        temp_data: { task_id: taskId }
      });
      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await sendMessage(chatId, "✍ *اكتب ملاحظات التعديل والرفض* بالتفصيل ليتم إرسالها وتوجيه العضو:");
    }
    return;
  }

  // موافقة الجودة وإتمام المكافأة التلقائية
  if (data.startsWith("rate_do_")) {
    const parts = data.split("_");
    const taskId = parts[2];
    const ratingVal = parseInt(parts[3]);

    const { data: task } = await supabase.from('tasks').select('*').eq('id', taskId).single();
    if (task) {
      // تحديد قيمة المكافأة التلقائية بناءً على صعوبة المهمة
      let reward = 10; // افتراضي Medium
      if (task.difficulty === 'Easy') reward = 5;
      else if (task.difficulty === 'Hard') reward = 20;

      // تحديث رصيد العضو
      const { data: targetMember } = await supabase.from('users').select('balance').eq('telegram_id', task.assigned_to).single();
      const updatedBalance = (targetMember?.balance || 0) + reward;

      await supabase.from('users').update({ balance: updatedBalance }).eq('telegram_id', task.assigned_to);

      // إتمام المهمة
      await supabase.from('tasks').update({
        status: 'Completed',
        rating: ratingVal,
        completed_at: new Date().toISOString()
      }).eq('id', taskId);

      // تسجيل العملية البنكية التلقائية
      await supabase.from('transactions').insert([{
        sender_id: 'system_reward',
        receiver_id: task.assigned_to,
        amount: reward,
        details: `مكافأة تلقائية لإتمام مهمة "${task.task_name}" [صعوبة: ${task.difficulty}]`
      }]);

      await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: [] });
      await sendMessage(chatId, `✅ تم موافقة واعتماد العمل بإنتاجية ممتازة وتقييم جودة [${ratingVal} نجوم] بنجاح، وتم صرف مكافأة تلقائية بقيمة ${reward}$ لحسابه.`);
      await sendMessage(task.assigned_to, `🎉 ممتاز! تمت الموافقة على تسليمك لمهمة "${task.task_name}" من قبل الإدارة بـ تقييم جودة [${ratingVal} نجوم] وصرف مكافأتها التلقائية المعتمدة بقيمة [${reward}$] لحسابك المالي.`);
    }
    return;
  }

  // تفاعل البنك وخزينة الفريق والتحويل للأعضاء
  if (data === "bank_deposit" || data === "bank_send" || data === "admin_penalize_menu") {
    const { data: list } = await supabase.from('users').select('telegram_id, username, display_name');
    let keyboard: any[] = [];
    list?.forEach((m: any) => {
      if (m.telegram_id !== userId) {
        if (data === "admin_penalize_menu") {
          keyboard.push([{ text: `🚨 مخالفة: ${m.display_name}`, callback_data: `bank_target_penalty_${m.telegram_id}` }]);
        } else {
          keyboard.push([{ text: `${m.display_name} (${m.username})`, callback_data: `bank_target_${data.replace("bank_", "")}_${m.telegram_id}` }]);
        }
      }
    });
    await editMessageReplyMarkup(chatId, messageId, { inline_keyboard: keyboard });
    return;
  }
  if (data.startsWith("bank_target_")) {
    const parts = data.split("_");
    const action = parts[2]; 
    const targetId = parts[3];

    if (action === "deposit") {
      await supabase.from('user_states').upsert({ telegram_id: userId, step: 'deposit_amount', temp_data: { target_user_id: targetId } });
      await sendMessage(chatId, "💵 اكتب قيمة مبلغ المكافأة للإيداع (بالأرقام):");
    } else if (action === "send") {
      await supabase.from('user_states').upsert({ telegram_id: userId, step: 'send_amount', temp_data: { target_user_id: targetId } });
      await sendMessage(chatId, "💸 اكتب قيمة المبلغ الذي ترغب في تحويله (بالأرقام):");
    } else if (action === "penalty") {
      await supabase.from('user_states').upsert({ telegram_id: userId, step: 'penalty_amount', temp_data: { target_user_id: targetId } });
      await sendMessage(chatId, "🚨 اكتب قيمة الخصم والمخالفة المالية (بالأرقام):");
    }
    return;
  }

  if (data.startsWith("view_tasks_")) {
    const statusType = data.replace("view_tasks_", "");
    const { data: list } = await supabase.from('tasks').select('*').eq('status', statusType).limit(10);

    let msg = `📋 قائمة المهام لـ (${statusType}):\n\n`;
    if (!list || list.length === 0) {
      msg += "لا توجد مهام حالية تحت هذا التصنيف.";
      await sendMessage(chatId, msg);
    } else {
      list.forEach(async (t: any) => {
        let taskDetailMsg = `🆔 رقم: ${t.id}\n📌 الاسم: ${t.task_name}\n⏳ التسليم: ${t.deadline}\n📊 الصعوبة: ${t.difficulty}\n------------------`;
        const actionKb = {
          inline_keyboard: [
            [
              { text: "⏳ تمديد الموعد", callback_data: `extend_dl_${t.id}` },
              { text: "🔄 تحويل لعضو آخر", callback_data: `reassign_task_${t.id}` }
            ],
            [
              { text: "🗑️ إلغاء المهمة", callback_data: `cancel_task_${t.id}` }
            ]
          ]
        };
        await sendMessage(chatId, taskDetailMsg, actionKb);
      });
    }
    return;
  }
}

// -------------------------------------------------------------
// محرك التوجيه الآلي للمهام بناءً على الأولويات والأعضاء النشطين
// -------------------------------------------------------------
async function routeTaskToNextPriority(task: any) {
  const nextPriority = task.current_priority_index + 1;
  const primaryJob = task.job_types ? task.job_types.split(",")[0] : "مبيض";

  // جلب العضو ذو الأولوية التالية ويشترط أن يكون متاحاً للعمل وغير حاصل على إجازة
  const { data: candidates } = await supabase
    .from('users')
    .select('*')
    .eq('job_title', primaryJob)
    .eq('priority', nextPriority)
    .eq('is_active', true)
    .eq('status', 'active');

  const nextCandidate = candidates && candidates.length > 0 ? candidates[0] : null;

  if (nextCandidate) {
    await supabase.from('tasks').update({
      assigned_to: nextCandidate.telegram_id,
      current_priority_index: nextPriority
    }).eq('id', task.id);

    await sendTaskOfferToMember(nextCandidate.telegram_id, {
      ...task,
      assigned_to: nextCandidate.telegram_id,
      current_priority_index: nextPriority
    });

    await sendAdminAlert(`🔄 تم تحويل مهمة "${task.task_name}" آلياً للعضو @${nextCandidate.username} (أولوية ${nextPriority}) بعد رفضها من العضو السابق.`);
  } else {
    await supabase.from('tasks').update({ assigned_to: null, status: 'Pending' }).eq('id', task.id);
    await sendAdminAlert(`⚠️ المهمة "${task.task_name}" تم رفضها من كافة أعضاء الأولوية النشطين في تخصص "${primaryJob}". تم وضعها كمعلقة بانتظار المدير.`);
  }
}

// دالة منع تصادم الأولوية للتخصص الواحد (Collision-free Priority logic)
async function getCollisionFreePriority(jobTitle: string, requestedPriority: number): Promise<number> {
  let checkPrio = requestedPriority;
  while (true) {
    const { data: duplicate } = await supabase
      .from('users')
      .select('telegram_id')
      .eq('job_title', jobTitle)
      .eq('priority', checkPrio)
      .maybeSingle();

    if (!duplicate) {
      break;
    }
    checkPrio++; // ترحيل للأولوية التالية المتاحة تلقائياً
  }
  return checkPrio;
}

// -------------------------------------------------------------
// وظائف المساعدات وإشعارات الإدارة المتنوعة
// -------------------------------------------------------------
async function sendTaskOfferToMember(memberId: string, task: any) {
  const offerMsg = `🎁 مهمة تيم مانجا جديدة معروضة عليك!
📌 الاسم: ${task.task_name}
📊 الصعوبة: ${task.difficulty}
⏰ الموعد النهائي: ${task.deadline}
📝 ملاحظة خاصة: ${task.description || "لا يوجد"}`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ قبول المهمة", callback_data: `accept_task_${task.id}` },
        { text: "❌ رفض وتمرير", callback_data: `reject_task_${task.id}` }
      ]
    ]
  };

  await sendDocument(memberId, task.file_id, "الملف الأصلي للمهمة");
  await sendMessage(memberId, offerMsg, keyboard);
}

async function showMemberTasks(chatId: any, userId: string) {
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('assigned_to', userId)
    .neq('status', 'Completed');

  let msg = "📋 مهامك الجارية حالياً:\n\n";
  if (!tasks || tasks.length === 0) {
    msg += "لا توجد مهام جارية حالية في واجهتك.";
  } else {
    tasks.forEach((t: any) => {
      msg += `🆔 رقم: ${t.id}\n📌 الاسم: ${t.task_name}\n⏳ التسليم: ${t.deadline}\n📊 الحالة: ${t.status}\n------------------\n`;
    });
  }

  let inlineKb: any[] = [];
  tasks?.forEach((t: any) => {
    if (t.status === 'In_Progress') {
      inlineKb.push([{ text: `📥 تسليم عمل المهمة ${t.id}`, callback_data: `submit_task_${t.id}` }]);
    }
  });

  await sendMessage(chatId, msg, { inline_keyboard: inlineKb });
}

async function showStatsReports(chatId: any) {
  const { data: members } = await supabase.from('users').select('*');
  const { data: tasks } = await supabase.from('tasks').select('*');

  let report = `📊 تقرير الفريق والإنتاجية المتكامل:\n\n`;
  report += `👤 إجمالي قوى الأعضاء بالفريق: ${members?.length || 0}\n`;
  report += `📝 إجمالي المهام المنشأة: ${tasks?.length || 0}\n\n`;

  report += `⚙️ سجل تفاصيل الأعضاء ومقادير أرصدتهم:\n`;
  members?.forEach((m: any) => {
    let activeText = m.is_active ? "🟢 متاح" : "🔴 مشغول";
    if (m.status === 'on_leave') activeText = "🟡 في إجازة";
    else if (m.status === 'resigned') activeText = "🚫 مستقيل";
    
    report += `- ${m.display_name} (@${m.username || 'لا يوجد'}): ${m.job_title} (الأولوية: ${m.priority}) - الرصيد: ${m.balance}$ [${activeText}]\n`;
  });

  await sendMessage(chatId, report);
}

async function sendSubmissionReviewAlert(taskId: any, type: string, content: string, username: string) {
  const alertMsg = `📥 قام العضو @${username} بتسليم عمل المهمة رقم (${taskId})\nالنوع: ${type}\n\nيرجى مراجعة العمل المسلم واتخاذ الإجراء:`;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "✅ قبول واعتماد", callback_data: `approve_task_${taskId}` },
        { text: "❌ رفض وإعادة للتعديل", callback_data: `reject_sub_${taskId}` }
      ]
    ]
  };

  const { data: admins } = await supabase.from('users').select('telegram_id').eq('role', 'admin');
  admins?.forEach(async (admin: any) => {
    if (type === 'ملف مرفق') {
      await sendDocument(admin.telegram_id, content, "الملف النهائي المرفوع");
    } else {
      await sendMessage(admin.telegram_id, `🔗 الرابط المرفق للتسليم:\n${content}`);
    }
    await sendMessage(admin.telegram_id, alertMsg, keyboard);
  });
}

// -------------------------------------------------------------
// لوحات التحكم والإشعارات الرئيسية المضمنة (Inline Interfaces)
// -------------------------------------------------------------
async function sendAdminInlineDashboard(chatId: any, text: string) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🆕 إنشاء مهمة جديدة", callback_data: "admin_new_task" },
        { text: "👥 إضافة عضو جديد", callback_data: "admin_add_member" }
      ],
      [
        { text: "📊 إنتاجية العضو بالتفصيل", callback_data: "admin_member_stats" },
        { text: "📝 تعديل بيانات الأعضاء", callback_data: "admin_edit_member_menu" }
      ],
      [
        { text: "🏖️ مراجعة طلبات الإجازة", callback_data: "admin_leave_requests" },
        { text: "🚫 مراجعة طلبات الاستقالة", callback_data: "admin_resignation_requests" }
      ],
      [
        { text: "🚨 تسجيل مخالفة وخصم", callback_data: "admin_penalize_menu" },
        { text: "💸 سحوبات معلقة", callback_data: "admin_withdrawals" }
      ],
      [
        { text: "🔍 مراقبة جميع المهام", callback_data: "admin_view_tasks" },
        { text: "🏦 بنك وخزينة الفريق", callback_data: "admin_bank" }
      ],
      [
        { text: "🚨 المهام المتأخرة بالوقت", callback_data: "admin_overdue_tasks" },
        { text: "🏆 لوحة صدارة الفريق", callback_data: "admin_leaderboard" }
      ],
      [
        { text: "📢 إرسال إشعار جماعي", callback_data: "admin_broadcast" },
        { text: "📊 تقارير وأنشطة الفريق", callback_data: "admin_stats" }
      ]
    ]
  };
  await sendMessage(chatId, text, keyboard);
}

async function sendMemberInlineDashboard(chatId: any, text: string, isActive: boolean, status: string) {
  const toggleText = isActive ? "🔴 تغيير الحالة إلى: مشغول" : "🟢 تغيير الحالة إلى: متاح";
  const toggleVal = isActive ? "false" : "true";

  const leaveBtn = status === 'on_leave' ? { text: "🟢 العودة من الإجازة", callback_data: "member_leave_menu" } : { text: "🏖️ طلب إجازة رسمية", callback_data: "member_leave_menu" };

  const keyboard = {
    inline_keyboard: [
      [
        { text: "📋 مهامي الحالية", callback_data: "member_tasks" },
        { text: "💰 البنك والرصيد", callback_data: "member_bank" }
      ],
      [
        { text: "📅 تسجيل الحضور اليومي", callback_data: "member_check_in" }
      ],
      [
        { text: toggleText, callback_data: `member_toggle_active_${toggleVal}` },
        { text: "⭐ تعديل أولويتي الوظيفية", callback_data: "member_priority_menu" }
      ],
      [
        leaveBtn,
        { text: "🚫 تقديم استقالة", callback_data: "member_resign_menu" }
      ],
      [
        { text: "🏆 لوحة الصدارة", callback_data: "member_leaderboard" }
      ]
    ]
  };
  await sendMessage(chatId, text, keyboard);
}

async function sendJobTypeSelectionKeyboard(chatId: any) {
  const keyboard = await generateJobSelectorKeyboard([]);
  await sendMessage(chatId, "⚙️ اختر المهام والتخصصات المطلوبة لهذا العمل:", keyboard);
}

async function generateJobSelectorKeyboard(selectedJobs: string[]) {
  const jobs = ["تبييض", "ترجمة", "تحرير", "تدقيق", "تلوين", "تصميم"];
  const inlineKeyboard = [];

  for (let i = 0; i < jobs.length; i += 2) {
    const row = [];
    const job1 = jobs[i];
    const isSel1 = selectedJobs.includes(job1) ? "✅ " : "";
    row.push({ text: `${isSel1}${job1}`, callback_data: `job_select_${job1}` });

    if (i + 1 < jobs.length) {
      const job2 = jobs[i + 1];
      const isSel2 = selectedJobs.includes(job2) ? "✅ " : "";
      row.push({ text: `${isSel2}${job2}`, callback_data: `job_select_${job2}` });
    }
    inlineKeyboard.push(row);
  }

  inlineKeyboard.push([{ text: "🌟 تم الاختيار والانتقال للخطوة التالية", callback_data: "jobs_done" }]);
  return { inline_keyboard: inlineKeyboard };
}

async function sendJobTitlesSelectionKeyboard(chatId: any) {
  const jobs = ["تبييض", "ترجمة", "تحرير", "تدقيق", "تلوين", "تصميم"];
  const inlineKeyboard = [];
  
  for (let i = 0; i < jobs.length; i += 2) {
    const row = [
      { text: jobs[i], callback_data: `title_select_${jobs[i]}` }
    ];
    if (i + 1 < jobs.length) {
      row.push({ text: jobs[i + 1], callback_data: `title_select_${jobs[i + 1]}` });
    }
    inlineKeyboard.push(row);
  }
  await sendMessage(chatId, "⚙️ حدد الوظيفة/القسم الأساسي للعضو الجديد:", { inline_keyboard: inlineKeyboard });
}

async function sendNotificationChoiceKeyboard(chatId: any) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🔔 نعم، أرسل إشعار عام", callback_data: "notify_yes" },
        { text: "🔕 لا، إنشاء بهدوء", callback_data: "notify_no" }
      ]
    ]
  };
  await sendMessage(chatId, "📢 هل ترغب في إرسال إشعار فوري وتنبيه لكافة أعضاء الفريق عن توفر هذه المهمة؟", keyboard);
}

async function sendTasksOverviewKeyboard(chatId: any) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "⏳ قيد المراجعة", callback_data: "view_tasks_Under_Review" },
        { text: "🛠️ قيد العمل", callback_data: "view_tasks_In_Progress" }
      ],
      [
        { text: "📦 المكتملة", callback_data: "view_tasks_Completed" },
        { text: "❌ الملغية / المرفوضة", callback_data: "view_tasks_Cancelled" }
      ]
    ]
  };
  await sendMessage(chatId, "🔍 حدد تصنيف المهام الذي ترغب في مراقبته وعرضه:", keyboard);
}

async function sendBankKeyboard(chatId: any) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "💵 إيداع مباشر لعضو (مكافأة)", callback_data: "bank_deposit" },
        { text: "💸 تحويل نقود داخلي", callback_data: "bank_send" }
      ]
    ]
  };
  await sendMessage(chatId, "🏦 أهلاً بك في خزينة وبنك الفريق. حدد المعاملة المراد إتمامها:", keyboard);
}

// -------------------------------------------------------------
// دوال المساعدة لربط اتصالات Telegram API الخارجية
// -------------------------------------------------------------
async function sendMessage(chatId: any, text: string, replyMarkup: any = null) {
  const body: any = { chat_id: chatId, text };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

async function sendDocument(chatId: any, fileId: string, caption: string) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, document: fileId, caption })
  });
}

async function editMessageReplyMarkup(chatId: any, messageId: any, replyMarkup: any) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: replyMarkup })
  });
}

async function sendAdminAlert(text: string) {
  const { data: admins } = await supabase.from('users').select('telegram_id').eq('role', 'admin');
  admins?.forEach(async (admin: any) => {
    await sendMessage(admin.telegram_id, text);
  });
}


