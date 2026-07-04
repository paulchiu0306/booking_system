import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';

export default function App() {
  const [formId, setFormId] = useState(null);
  const [view, setView] = useState('admin'); // admin | user
  const [forms, setForms] = useState([]);
  const [selectedForm, setSelectedForm] = useState(null);
  
  // 表單與時段編輯狀態
  const [newFormTitle, setNewFormTitle] = useState('');
  const [fields, setFields] = useState([]);
  const [slots, setSlots] = useState([]);
  const [bookings, setBookings] = useState([]);
  
  // 新增欄位/時段暫存
  const [newField, setNewField] = useState({ label: '', type: 'text', required: false });
  const [newSlot, setNewSlot] = useState({ slot_date: '', slot_time: '', capacity: 10 });
  const [todayFilter, setTodayFilter] = useState(new Date().toISOString().split('T')[0]);

  // 使用者端填寫狀態
  const [userResponses, setUserResponses] = useState({});
  const [selectedSlotId, setSelectedSlotId] = useState('');

  // 初始化檢查網址參數
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('formId');
    if (id) {
      setFormId(id);
      setView('user');
      loadUserData(id);
    } else {
      loadAdminData();
    }
  }, []);

  // --- 資料載入邏輯 ---
  const loadAdminData = async () => {
    const { data } = await supabase.from('forms').select('*');
    setForms(data || []);
  };

  const selectFormForAdmin = async (form) => {
    setSelectedForm(form);
    // 載入欄位
    const { data: fFields } = await supabase.from('form_fields').select('*').eq('form_id', form.id).order('field_order');
    setFields(fFields || []);
    // 載入時段
    const { data: fSlots } = await supabase.from('time_slots').select('*').eq('form_id', form.id);
    setSlots(fSlots || []);
    // 載入預約明細
    const { data: fBookings } = await supabase.from('bookings').select('*, time_slots(*)').eq('form_id', form.id);
    setBookings(fBookings || []);
  };

  // 即時刷新當日明細功能
  const handleRefreshAdminData = async () => {
    if (!selectedForm) return;
    const { data: fBookings } = await supabase.from('bookings').select('*, time_slots(*)').eq('form_id', selectedForm.id);
    setBookings(fBookings || []);
  };

  const loadUserData = async (id) => {
    const { data: form } = await supabase.from('forms').select('*').eq('id', id).single();
    if (!form) return alert('找不到該表單');
    setSelectedForm(form);
    const { data: fFields } = await supabase.from('form_fields').select('*').eq('form_id', id).order('field_order');
    setFields(fFields || []);
    const { data: fSlots } = await supabase.from('time_slots').select('*').eq('form_id', id);
    setSlots(fSlots || []);
    // 前台也要載入預約紀錄，才能計算剩餘名額
    const { data: fBookings } = await supabase.from('bookings').select('*').eq('form_id', id);
    setBookings(fBookings || []);
  };

  // --- 後台管理操作 ---
  const handleCreateForm = async () => {
    if (!newFormTitle) return;
    const { data, error } = await supabase.from('forms').insert([{ title: newFormTitle }]).select().single();
    if (data) {
      setForms([...forms, data]);
      setNewFormTitle('');
      selectFormForAdmin(data);
    }
  };

  // 刪除報名表功能
  const handleDeleteForm = async (id, e) => {
    e.stopPropagation(); // 阻止點擊刪除按鈕時觸發選擇表單的事件
    if (!window.confirm("確定要刪除此報名表及其所有相關設定與預約嗎？（此動作無法復原）")) return;

    const { error } = await supabase.from('forms').delete().eq('id', id);
    if (!error) {
      alert("報名表刪除成功！");
      const updatedForms = forms.filter(f => f.id !== id);
      setForms(updatedForms);
      
      if (selectedForm?.id === id) {
        setSelectedForm(null);
        setFields([]);
        setSlots([]);
        setBookings([]);
      }
    } else {
      alert("刪除失敗，請檢查資料庫關聯設定。");
    }
  };

  const handleAddField = async () => {
    if (!newField.label || !selectedForm) return;
    const { data } = await supabase.from('form_fields').insert([{ ...newField, form_id: selectedForm.id, field_order: fields.length }]).select().single();
    if (data) setFields([...fields, data]);
  };

  const handleDeleteField = async (id) => {
    await supabase.from('form_fields').delete().eq('id', id);
    setFields(fields.filter(f => f.id !== id));
  };

  const handleAddSlot = async () => {
    if (!newSlot.slot_date || !newSlot.slot_time || !selectedForm) return;
    const { data } = await supabase.from('time_slots').insert([{ ...newSlot, form_id: selectedForm.id }]).select().single();
    if (data) setSlots([...slots, data]);
  };

  const handleDeleteSlot = async (id) => {
    await supabase.from('time_slots').delete().eq('id', id);
    setSlots(slots.filter(s => s.id !== id));
  };

  // 【新功能】後台管理端：刪除特定單筆預約紀錄（清除測試資料用）
  const handleDeleteBooking = async (id) => {
    if (!window.confirm("確定要刪除這筆預約紀錄嗎？（這將會釋放該時段的名額）")) return;
    
    const { error } = await supabase.from('bookings').delete().eq('id', id);
    if (!error) {
      setBookings(bookings.filter(b => b.id !== id));
    } else {
      alert("刪除預約紀錄失敗，請稍後再試。");
    }
  };

  // 匯出 CSV 報表
  const handleExportCSV = () => {
    if (!bookings.length) return alert('目前沒有預約資料可匯出');
    let csvContent = "\uFEFF"; // 避免 Excel 開氣中文亂碼 (BOM)
    
    // 表頭
    const headers = ['預約日期', '預約時間', ...fields.map(f => f.label), '填寫時間'];
    csvContent += headers.join(',') + '\n';
    
    // 內容
    bookings.forEach(b => {
      const row = [
        b.time_slots?.slot_date || '',
        b.time_slots?.slot_time || '',
        ...fields.map(f => b.responses[f.id] || ''),
        new Date(b.created_at).toLocaleString()
      ];
      csvContent += row.map(val => `"${val}"`).join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `${selectedForm.title}_預約名冊.csv`);
    link.click();
  };

  // --- 使用者端送出報名 ---
  const handleUserSubmit = async (e) => {
    e.preventDefault();
    if (!selectedSlotId) return alert('請選擇預約時段');

    // 檢查該時段是否已滿
    const { data: existingBookings } = await supabase.from('bookings').select('id').eq('time_slot_id', selectedSlotId);
    const targetSlot = slots.find(s => s.id === selectedSlotId);
    if (existingBookings && existingBookings.length >= targetSlot.capacity) {
      return alert('非常抱歉，該時段名額已滿，請選擇其他時段！');
    }

    const { error } = await supabase.from('bookings').insert([{
      form_id: selectedForm.id,
      time_slot_id: selectedSlotId,
      responses: userResponses
    }]);

    if (!error) {
      alert('預約成功！');
      setUserResponses({});
      setSelectedSlotId('');
      if (formId) loadUserData(formId);
    } else {
      alert('預約失敗，請稍後再試。');
    }
  };

  // 計算時段剩餘名額
  const getRemainingSlots = (slot) => {
    const bookedCount = bookings.filter(b => b.time_slot_id === slot.id).length;
    return slot.capacity - bookedCount;
  };

  // --- 畫面渲染 ---
  if (view === 'user') {
    if (!selectedForm) return <div className="p-8 text-center text-gray-500">載入中...</div>;
    return (
      <div className="max-w-xl mx-auto my-10 p-6 bg-white shadow-lg rounded-lg border border-gray-100">
        <h2 className="text-2xl font-bold text-center text-blue-600 mb-6">{selectedForm.title}</h2>
        <form onSubmit={handleUserSubmit} className="space-y-5">
          {fields.map(field => (
            <div key={field.id} className="flex flex-col">
              <label className="mb-1 font-medium text-gray-700">
                {field.label} {field.required && <span className="text-red-500">*</span>}
              </label>
              <input
                type={field.type}
                required={field.required}
                className="p-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 outline-none"
                onChange={(e) => setUserResponses({ ...userResponses, [field.id]: e.target.value })}
              />
            </div>
          ))}

          <div className="flex flex-col">
            <label className="mb-1 font-medium text-gray-700">選擇預約時段 <span className="text-red-500">*</span></label>
            <select
              required
              className="p-2.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-400 outline-none"
              value={selectedSlotId}
              onChange={(e) => setSelectedSlotId(e.target.value)}
            >
              <option value="">-- 請選擇日期與時間 --</option>
              {slots
                .filter(s => getRemainingSlots(s) > 0)
                .sort((a, b) => {
                  if (a.slot_date !== b.slot_date) {
                    return a.slot_date.localeCompare(b.slot_date);
                  }
                  return a.slot_time.localeCompare(b.slot_time);
                })
                .map(s => {
                  const remaining = getRemainingSlots(s);
                  return (
                    <option key={s.id} value={s.id}>
                      {s.slot_date} ({s.slot_time.substring(0, 5)}) — 剩餘名額：{remaining} 人
                    </option>
                  );
                })
              }
            </select>
          </div>

          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-md transition duration-200">
            送出預約報名
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-extrabold text-gray-800 mb-8 border-b pb-4">預約報名系統 - 後台管理</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* 左側：表單列表與建立 */}
          <div className="bg-white p-4 shadow rounded-lg h-fit">
            <h3 className="font-bold text-gray-700 mb-3">1. 選擇或建立報名表</h3>
            <div className="flex gap-2 mb-4">
              <input
                type="text"
                placeholder="輸入新表單名稱"
                className="border p-2 rounded w-full text-sm"
                value={newFormTitle}
                onChange={(e) => setNewFormTitle(e.target.value)}
              />
              <button onClick={handleCreateForm} className="bg-blue-600 text-white px-3 text-sm rounded whitespace-nowrap">建立</button>
            </div>
            
            <div className="space-y-2">
              {forms.map(f => (
                <div
                  key={f.id}
                  className={`w-full flex items-center justify-between p-2.5 rounded text-sm transition ${
                    selectedForm?.id === f.id 
                      ? 'bg-blue-50 text-blue-600 font-semibold border-l-4 border-blue-600' 
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  }`}
                >
                  <button
                    onClick={() => selectFormForAdmin(f)}
                    className="text-left flex-1 truncate"
                  >
                    {f.title}
                  </button>
                  <button
                    onClick={(e) => handleDeleteForm(f.id, e)}
                    className="ml-2 text-xs text-red-500 hover:bg-red-100 px-2 py-1 rounded border border-red-200 bg-white shrink-0"
                  >
                    刪除
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 右側：表單設定與明細 */}
          {selectedForm ? (
            <div className="lg:col-span-3 space-y-6">
              {/* 動態公開網址 */}
              <div className="bg-blue-50 border border-blue-200 p-4 rounded-lg flex justify-between items-center">
                <div>
                  <span className="font-bold text-blue-800 text-sm">使用者填寫網址：</span>
                  <code className="bg-white px-2 py-1 rounded border text-xs ml-2 select-all">
                    {`${window.location.origin}${window.location.pathname}?formId=${selectedForm.id}`}
                  </code>
                </div>
                <a href={`?formId=${selectedForm.id}`} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline font-medium">打開測試 ↗</a>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* 欄位設定 */}
                <div className="bg-white p-5 shadow rounded-lg">
                  <h3 className="font-bold text-gray-800 mb-3 border-b pb-2">欄位設定 (CRUD)</h3>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="欄位名稱"
                      className="border p-2 rounded text-sm col-span-2"
                      value={newField.label}
                      onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                    />
                    <select
                      className="border p-2 rounded text-sm"
                      value={newField.type}
                      onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                    >
                      <option value="text">文字</option>
                      <option value="number">數字</option>
                      <option value="email">Email</option>
                      <option value="date">日期</option>
                    </select>
                  </div>
                  <button onClick={handleAddField} className="w-full bg-gray-800 text-white text-xs py-2 rounded mb-4">+ 新增欄位</button>
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {fields.map(f => (
                      <li key={f.id} className="flex justify-between items-center bg-gray-50 p-2 rounded text-sm">
                        <span>{f.label} <span className="text-gray-400 text-xs">({f.type})</span></span>
                        <button onClick={() => handleDeleteField(f.id)} className="text-red-500 text-xs">刪除</button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* 時段設定 */}
                <div className="bg-white p-5 shadow rounded-lg">
                  <h3 className="font-bold text-gray-800 mb-3 border-b pb-2">時段與人數設定</h3>
                  <div className="space-y-2 mb-3">
                    <input
                      type="date"
                      className="border p-2 rounded text-sm w-full"
                      value={newSlot.slot_date}
                      onChange={(e) => setNewSlot({ ...newSlot, slot_date: e.target.value })}
                    />
                    <input
                      type="time"
                      className="border p-2 rounded text-sm w-full"
                      value={newSlot.slot_time}
                      onChange={(e) => setNewSlot({ ...newSlot, slot_time: e.target.value })}
                    />
                    <input
                      type="number"
                      placeholder="名額上限 (人)"
                      className="border p-2 rounded text-sm w-full"
                      value={newSlot.capacity}
                      onChange={(e) => setNewSlot({ ...newSlot, capacity: parseInt(e.target.value) || 10 })}
                    />
                  </div>
                  <button onClick={handleAddSlot} className="w-full bg-gray-800 text-white text-xs py-2 rounded mb-4">+ 新增時段</button>
                  <ul className="space-y-2 max-h-48 overflow-y-auto">
                    {slots
                      .sort((a, b) => {
                        if (a.slot_date !== b.slot_date) {
                          return a.slot_date.localeCompare(b.slot_date);
                        }
                        return a.slot_time.localeCompare(b.slot_time);
                      })
                      .map(s => (
                        <li key={s.id} className="flex justify-between items-center bg-gray-50 p-2 rounded text-sm">
                          <span>{s.slot_date} / {s.slot_time.substring(0, 5)} <span className="text-blue-600 font-semibold">({s.capacity}人)</span></span>
                          <button onClick={() => handleDeleteSlot(s.id)} className="text-red-500 text-xs">刪除</button>
                        </li>
                      ))
                    }
                  </ul>
                </div>
              </div>

              {/* 當日預約明細與匯出 */}
              <div className="bg-white p-5 shadow rounded-lg">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 border-b pb-3 mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="font-bold text-gray-800">快速查看當日預約明細</h3>
                    <input
                      type="date"
                      className="border p-1.5 rounded text-sm"
                      value={todayFilter}
                      onChange={(e) => setTodayFilter(e.target.value)}
                    />
                    <button
                      onClick={handleRefreshAdminData}
                      className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1.5 rounded text-xs font-medium border border-gray-300 transition duration-150"
                    >
                      🔄 刷新
                    </button>
                  </div>
                  <button onClick={handleExportCSV} className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium px-4 py-2 rounded text-sm transition">
                    匯出完整 Excel (CSV)
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm text-gray-600">
                    <thead className="bg-gray-100 text-gray-700 uppercase text-xs">
                      <tr>
                        <th className="p-3">時間</th>
                        {fields.map(f => <th key={f.id} className="p-3">{f.label}</th>)}
                        {/* 增加操作欄頭 */}
                        <th className="p-3 text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bookings
                        .filter(b => b.time_slots?.slot_date === todayFilter)
                        .map(b => (
                          <tr key={b.id} className="border-b hover:bg-gray-50">
                            <td className="p-3 font-medium text-gray-900">{b.time_slots?.slot_time?.substring(0, 5)}</td>
                            {fields.map(f => (
                              <td key={f.id} className="p-3">{b.responses[f.id] || '-'}</td>
                            ))}
                            {/* 每一筆測試預約後方的新增刪除按鈕 */}
                            <td className="p-3 text-right">
                              <button
                                onClick={() => handleDeleteBooking(b.id)}
                                className="text-xs text-red-500 hover:bg-red-50 px-2 py-1 rounded border border-red-200 transition"
                              >
                                刪除紀錄
                              </button>
                            </td>
                          </tr>
                        ))}
                      {bookings.filter(b => b.time_slots?.slot_date === todayFilter).length === 0 && (
                        <tr>
                          <td colSpan={fields.length + 2} className="p-4 text-center text-gray-400">該日期目前無任何預約紀錄</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            <div className="lg:col-span-3 text-center py-20 bg-white shadow rounded-lg text-gray-400">
              ← 請在左側選擇一個現有的報名表，或輸入名稱並建立新表單。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
