const data=require('../data/requirements.js');
const {checkGraduation}=require('../js/checker.js');
function assert(cond,msg){if(!cond) throw new Error(msg)}
function syntheticGeneral(c){
  const rows=[]; let seq=0;
  for(const group of c.general.groups){
    const earned={};
    for(const item of group.items){
      const credit=item.min||0; earned[item.id]=credit;
      if(credit>0) rows.push({category:item.match.categories[0],name:`GEN-${seq++}-${item.label}`,credit,grade:'A'});
    }
    for(const pool of (group.pools||[])){
      let have=pool.itemIds.reduce((sum,id)=>sum+(earned[id]||0),0);
      if(have<pool.min){
        const id=pool.itemIds[0], it=group.items.find(x=>x.id===id), add=pool.min-have;
        rows.push({category:it.match.categories[0],name:`GEN-${seq++}-${it.label}`,credit:add,grade:'A'}); earned[id]=(earned[id]||0)+add;
      }
    }
    let have=group.items.reduce((sum,it)=>sum+Math.min(earned[it.id]||0,it.max==null?(earned[it.id]||0):it.max),0);
    let gap=group.target-have;
    for(const it of group.items){
      if(gap<=0) break;
      const now=earned[it.id]||0, cap=it.max==null?now+gap:it.max;
      const add=Math.max(0,Math.min(gap,cap-now));
      if(add){rows.push({category:it.match.categories[0],name:`GEN-${seq++}-${it.label}-extra`,credit:add,grade:'A'});earned[it.id]=now+add;gap-=add;}
    }
    assert(gap===0,`cannot synthesize general group ${group.label}`);
  }
  return rows;
}
function syntheticProfessional(c,major){
  const p=c.professional[major], rows=[];
  for(const course of p.courses.filter(x=>x.type==='required')) rows.push({category:'専門教育科目',name:course.name,credit:course.credit,grade:'A'});
  if(p.targets.selectRequired){
    const first=p.selectRequiredSets[0], map=new Map(p.courses.map(x=>[x.name,x]));
    for(const name of first.courses){const course=map.get(name);rows.push({category:'専門教育科目',name:course.name,credit:course.credit,grade:'A'});}
  }
  let e=0;
  for(const course of p.courses.filter(x=>x.type==='elective')){if(e>=p.targets.elective)break;rows.push({category:'専門教育科目',name:course.name,credit:course.credit,grade:'A'});e+=course.credit;}
  assert(e>=p.targets.elective,`not enough electives ${major}`);
  return rows;
}
for(const [year,c] of Object.entries(data)){
  const isT=c.professional.IS.targets, dsT=c.professional.DS.targets;
  assert(c.general.total+isT.required+isT.elective===c.graduationTotal,`${year}: IS totals`);
  assert(c.general.total+dsT.required+dsT.selectRequired+dsT.elective===c.graduationTotal,`${year}: DS totals`);
  const isReq=c.professional.IS.courses.filter(x=>x.type==='required').reduce((s,x)=>s+x.credit,0);
  const dsReq=c.professional.DS.courses.filter(x=>x.type==='required').reduce((s,x)=>s+x.credit,0);
  assert(isReq===isT.required,`${year}: IS required sum`); assert(dsReq===dsT.required,`${year}: DS required sum`);
  for(const set of c.professional.DS.selectRequiredSets){
    const map=new Map(c.professional.DS.courses.map(x=>[x.name,x]));
    assert(set.courses.reduce((s,n)=>s+map.get(n).credit,0)===dsT.selectRequired,`${year}: set ${set.label}`);
  }
  for(const major of ['IS','DS']){
    const full=[...syntheticGeneral(c),...syntheticProfessional(c,major)];
    const r=checkGraduation(full,c,major); assert(r.eligible,`${year} ${major}: full-pass failed (${r.requirementCounted})`);
    const req=c.professional[major].courses.find(x=>x.type==='required');
    assert(!checkGraduation(full.filter(x=>x.name!==req.name),c,major).eligible,`${year} ${major}: required-missing should fail`);
    if(major==='DS'&&c.professional.DS.targets.selectRequired){
      const set=c.professional.DS.selectRequiredSets[0];
      const broken=full.filter(x=>x.name!==set.courses[set.courses.length-1]);
      assert(!checkGraduation(broken,c,major).professional.selectRequired.satisfied,`${year} DS: broken set should fail`);
    }
  }
}
console.log('OK: 構造検証・全充足・必修欠落・DS選択必修欠落テストを通過しました。');


// DS選択必修の未使用系列を専門選択へ算入するテスト
for(const [year,c] of Object.entries(data)){
  const p=c.professional.DS;
  if(!p.targets.selectRequired || p.selectRequiredSets.length < 2) continue;

  const base=[...syntheticGeneral(c),...syntheticProfessional(c,'DS')];
  const firstSet=p.selectRequiredSets[0];
  const secondSet=p.selectRequiredSets[1];
  const courseMap=new Map(p.courses.map(x=>[x.name,x]));

  // 1系列目を選択必修として充足した状態で、2系列目の1科目を追加する。
  const extraName=secondSet.courses[0];
  const extraCourse=courseMap.get(extraName);
  const withExtra=[
    ...base,
    {category:'専門教育科目',name:extraCourse.name,credit:extraCourse.credit,grade:'A'}
  ];
  const extraResult=checkGraduation(withExtra,c,'DS');

  assert(
    extraResult.professional.elective.convertedSelectRequiredEarned===extraCourse.credit,
    `${year} DS: unused select-required course should count as elective`
  );
  assert(
    extraResult.professional.selectRequired.earned===p.targets.selectRequired,
    `${year} DS: selected set credits must not change`
  );

  // 2系列とも全て修得した場合、片方だけを選択必修に使い、
  // もう片方の全単位を専門選択へ回す。
  const secondAll=secondSet.courses.map(name=>{
    const course=courseMap.get(name);
    return {category:'専門教育科目',name:course.name,credit:course.credit,grade:'A'};
  });
  const bothResult=checkGraduation([...base,...secondAll],c,'DS');
  const secondCredits=secondSet.courses.reduce((sum,name)=>sum+courseMap.get(name).credit,0);

  assert(
    bothResult.professional.elective.convertedSelectRequiredEarned===secondCredits,
    `${year} DS: unused completed set should count fully as elective`
  );

  // どちらの系列も完成していない場合は専門選択へ回さない。
  const partialOnly=[
    ...syntheticGeneral(c),
    ...p.courses.filter(x=>x.type==='required').map(course=>({
      category:'専門教育科目',name:course.name,credit:course.credit,grade:'A'
    })),
    {category:'専門教育科目',name:courseMap.get(firstSet.courses[0]).name,credit:courseMap.get(firstSet.courses[0]).credit,grade:'A'},
    {category:'専門教育科目',name:courseMap.get(secondSet.courses[0]).name,credit:courseMap.get(secondSet.courses[0]).credit,grade:'A'}
  ];
  const partialResult=checkGraduation(partialOnly,c,'DS');
  assert(
    partialResult.professional.elective.convertedSelectRequiredEarned===0,
    `${year} DS: partial sets must not be converted before one set is completed`
  );
}
console.log('OK: DS選択必修の未使用系列→専門選択算入テストを通過しました。');
