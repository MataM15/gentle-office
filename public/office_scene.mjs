// Demo-owned port of the approved office. Default rendering is pixel-identical
// to office.js through our raster canvas; animation never changes its sources.
export const desks = [
  {id:'orchestrator', x:96, y:56, color:'#F095C8'},
  {id:'scout', x:40, y:294, color:'#9bd4cd'},
  {id:'writer', x:180, y:294, color:'#efc68e'},
  {id:'verifier', x:320, y:294, color:'#c3b4ed'},
];
export const walls = [
  [8,12,624,12], [8,12,12,408], [620,12,12,408],
  [8,408,268,12], [332,408,300,12], [256,24,12,80], [256,148,12,46],
  [20,182,120,12], [184,182,236,12], [464,182,156,12],
  [20,232,160,10], [224,232,288,10], [556,232,64,10],
  [456,242,12,58], [456,344,12,64],
];
export const bubbleFill = '#fff4d6';
// Lighten (+) or darken (-) a palette colour for pixel-art shading.
const shades = new Map();
function shade(hex, amount) {
  const key = hex + amount;
  if (!shades.has(key)) {
    const rgb = hex.slice(1).match(/../g).map(v => parseInt(v, 16));
    const mixed = rgb.map(v => Math.round(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount));
    shades.set(key, '#' + mixed.map(v => v.toString(16).padStart(2, '0')).join(''));
  }
  return shades.get(key);
}
export const frameCount = 84;

// Local browser time; no server timezone or tint over actors/UI.
export function officeLighting(date = new Date()) {
  const hour = date.getHours();
  return hour >= 7 && hour < 18 ? {period:'day', sky:'#78939c', reflection:'#b7c9ca', lamp:'#d1b6ab'}
    : hour >= 18 && hour < 21 ? {period:'evening', sky:'#ad7f89', reflection:'#efd3af', lamp:'#efd3af'}
    : {period:'night', sky:'#45465f', reflection:'#9691ac', lamp:'#fff4d6'};
}

export function createScene(ctx, avatar) {
  const box = (x,y,w,h,color) => { ctx.fillStyle = color; ctx.fillRect(x,y,w,h); };
  // One lit plank-tile: alternating tone, top highlight, bottom shade, rare scuff.
  function tile(left,top,right,bottom,tx,ty) {
    const n=(tx-16)/28+(ty-28)/28;
    box(left,top,right-left,bottom-top,(n&1)?'#7d6c73':'#817077');
    if (top===ty) box(left,top,right-left,1,'#8d7c83');
    if (bottom===ty+26) box(left,bottom-1,right-left,1,'#716068');
    if ((n*7+tx)%5===0 && right-left>14 && bottom-top>14) box(tx+9,ty+13,3,1,'#74636a');
    if ((n*3+ty)%7===0 && right-left>20 && bottom-top>20) box(tx+17,ty+7,1,3,'#74636a');
  }
  function floor(x,y,w,h) {
    box(x,y,w,h,'#76636a');
    for (let ty=28+Math.floor((y-28)/28)*28; ty<y+h; ty+=28)
      for (let tx=16+Math.floor((x-16)/28)*28; tx<x+w; tx+=28) {
        const left=Math.max(x,tx), top=Math.max(y,ty);
        const right=Math.min(x+w,tx+26), bottom=Math.min(y+h,ty+26);
        if (right>left && bottom>top) tile(left,top,right,bottom,tx,ty);
      }
  }
  function wall(x,y,w,h) {
    box(x,y+5,w,h,'#49303e'); box(x,y,w,h,'#d1b6ab'); box(x,y,w,3,'#f5eae2');
    if (w>h) {
      // Panel seams and a shaded lower edge give the plaster some depth.
      box(x,y+h-2,w,2,'#bfa398');
      for (let sx=x+28-(x%28); sx<x+w-2; sx+=28) box(sx,y+3,1,h-5,'#c7ab9f');
    } else { box(x,y,2,h,'#e6d6cc'); box(x+w-2,y,2,h,'#bfa398'); }
  }
  function shelf(x,y,w,memory) {
    box(x+4,y+6,w,64,'#241923'); box(x,y,w,64,'#8c6262');
    box(x,y,w,2,'#a67a6e'); box(x,y,2,64,'#a67a6e'); box(x+w-2,y+2,2,62,'#765466');
    const spines = memory ? ['#b894ac','#a1799a','#c9a9bd','#b08aa6'] : ['#9bd4cd','#efc68e','#c3b4ed'];
    for (let row=0;row<2;row++) {
      box(x+4,y+6+row*28,w-8,22,'#392b35'); box(x+4,y+6+row*28,w-8,3,'#2d222c');
      for (let col=0;col<(w-12)/16;col++) {
        const bx=x+8+col*16, by=y+9+row*28, gap=(col*5+row*3)%7===4;
        // Book heights vary; one slot per shelf stays empty and one book leans.
        const bh=gap ? 0 : 17-((col+row*2)%3)*2, top=by+17-bh, color=spines[(col+row)%spines.length];
        if (gap) { box(bx+3,by+13,6,4,'#cda28a'); continue; }
        box(bx,top,10,bh,color); box(bx,top,2,bh,shade(color,.18)); box(bx+8,top,2,bh,shade(color,-.18));
        box(bx+2,top+4,6,3,'#f5eae2'); box(bx+3,top+bh-4,4,1,shade(color,-.3));
        if ((col+row)%4===1) { box(bx+10,by+3,3,14,shade(color,-.1)); box(bx+10,by+3,1,14,shade(color,.2)); }
      }
    }
    box(x,y+60,w,4,'#cda28a'); box(x,y+60,w,1,'#efd3af');
    if (memory) {
      // A small plant and a box file keep the shelf tops from looking bare.
      box(x+8,y-12,10,12,'#8c6262'); box(x+6,y-14,14,3,'#cda28a');
      box(x+9,y-22,3,8,'#6f9a7c'); box(x+13,y-26,3,12,'#4d7a63'); box(x+16,y-20,3,6,'#8fbf94');
      box(x+w-30,y-10,22,10,'#c3b4ed'); box(x+w-30,y-10,22,2,'#d9cef3'); box(x+w-24,y-6,10,3,'#f5eae2');
    }
  }
  function chair(x,y) {
    box(x-8,y+24,48,44,'#392b35'); box(x-5,y+27,42,34,'#514353');
    box(x-3,y+29,3,20,'#8c6262'); box(x+32,y+29,3,20,'#8c6262');
    box(x-8,y+60,48,6,'#765466');
    // Headrest stitching, armrest highlights and a caster base.
    box(x-5,y+27,42,2,'#625066'); box(x+15,y+29,2,28,'#463a49');
    box(x-3,y+29,1,20,'#a67a6e'); box(x+32,y+29,1,20,'#a67a6e');
    box(x-8,y+60,48,1,'#8a6a7c'); box(x+12,y+66,8,6,'#241923');
    box(x+4,y+71,24,2,'#241923'); box(x+3,y+72,3,2,'#1A1218'); box(x+26,y+72,3,2,'#1A1218');
  }
  // The orchestrator's head, reduced from the reference portrait to the office
  // palette and retouched by hand (eyes, brows). One character per pixel.
  const headRows = [
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '................................',
    '............#H....h.............',
    '..........##H#HHrrhh##..........',
    '.......###r###HrrrH####r........',
    '......H#H#rrHH#rrrrHH###rH.H....',
    '.....H#H#rr###rr#rr#####hhHH....',
    '....r######rrHH#rr#r#H#H####....',
    '...#r######rr#rr##HH##HHH####...',
    '..#rr##r#HH##HHrr#HHH###HHH##...',
    '.H#rrrr#rrHHH#hhrr####HHHHHH#...',
    '.H#rrr#rrr#Hrr##hhhh###hLHHH#...',
    '.HHH##r##r#rrLrLLLLSLLhLsLH#H...',
    '#HHHHr##HH#SLLSSsddSShLsds#HH...',
    '.HHHHHH###LSSLSsdddSSsssdssH....',
    '.HHHHH##HrLSsssddddddssddsSH....',
    '.##HHHHHrrLsdssrrdddddsddsSH....',
    '.H#HHHH##LsdsLrrrrrddddddsSS....',
    '.HHHHH#H#sddSLsssrhddhdsL##S....',
    '..HShHHHhsdsSSLHHHHHLhsHHHHr....',
    '..LLShH#hsddsSSsdddsLsdsddsr....',
    '.hSSSS##LddddsLSWBHSssdWBHS.....',
    '.hSsLL##LddddddSSSSSssdSSSS.....',
    '..SsLsLHLdddddddddddsssdSSSh....',
    '..SsssLHLdsdddddddddsssdsssL....',
    '..SSsLLHLssddddddddssssddssL....',
    '...SddSSSsssddddddsssssssssL....',
    '...SSdSLSsssddddssdss#sssssL....',
    '....HhhLSsssdddsLLL######rLL....',
    '....HLLLSssdsdss#####r####r.....',
    '....HLLLSsdddssrrr###rHH####....',
    '.....LdLLSsdds#############HH...',
    '.....LdLLSSsdsshhLLLLSSL###H....',
    '.....dddhLSSsdsSSSssSLhLLL......',
    '....#sdddhLSSssSsssdShLLLL......',
    '....#sddsLLLSSSssssddSLSL.......',
    '....sssddsLhhLSSSsddddsSS.......',
    '....sssdddSLhhLLLSssssdSS.......',
    '....sssdddsSLLhhLLSSSSSS........',
    '....sssddddsSSLLhLhhhhS.........',
    '........LLLLLLLLLLLLLLL.........',
    '........SSSSSSSSSSSLLLL.........',
    '........SSSSSSSSSSSLLLL.........',
  ];
  const headPalette = {'#':'#34282a', 'H':'#211c20', 'h':'#754c40', 'r':'#514039', 'L':'#ad6e54', 'S':'#d4946d', 's':'#e4a780', 'd':'#f2bf94', 'W':'#faf0e3', 'B':'#57959c'};
  function head(x,y,paint=box) {
    headRows.forEach((row,r) => {
      for (let c=0; c<row.length;) {
        let end=c+1;
        while (end<row.length && row[end]===row[c]) end++;
        if (row[c]!=='.') paint(x+c,y+r,end-c,1,headPalette[row[c]]);
        c=end;
      }
    });
  }
  // `arm` is the walking swing in pixels (positive: left hand forward/down);
  // `carry` keeps the right arm still because it holds a book or cup.
  function actor(x,y,color,id,drawChair=true,paint=box,arm=0,carry=false) {
    if (drawChair) chair(x,y);
    // A separate paint function lets walking reuse every head/outfit pixel.
    const box = paint, walking = !drawChair;
    const dark = shade(color,-.16), light = shade(color,.16);
    if (id==='orchestrator') {
      const aL=walking ? arm : 0, aR=walking && !carry ? -arm : 0;
      box(x+9,y+33,15,8,'#ad6e54'); box(x+12,y+35,10,6,'#d4946d');
      box(x+6,y+34,6,4,color); box(x+24,y+34,4,4,color);
      box(x+2,y+38,30,18,color);
      box(x+30,y+40,4,14+aR,'#c875a1'); box(x+2,y+40,2,12,'#ffc0df');
      box(x+28,y+43,4,13,'#c875a1'); box(x+7,y+36,3,4,'#faf0e3');
      box(x+10,y+40,4,3,'#faf0e3'); box(x+24,y+36,3,4,'#faf0e3');
      box(x+20,y+40,4,3,'#faf0e3'); box(x+16,y+43,2,13,'#c875a1');
      // Jacket hem, buttons, pocket square and fold creases.
      box(x+2,y+52,30,4,dark); box(x+16,y+46,2,2,'#faf0e3'); box(x+16,y+50,2,2,'#faf0e3');
      box(x+22,y+46,6,1,dark); box(x+8,y+47,5,1,dark); box(x+25,y+42,3,2,'#ffc0df');
      // Sleeves: the left one swings, the right one only when no prop is held.
      box(x-2,y+40,6,14+aL,color); box(x-2,y+40,2,14+aL,'#ffc0df'); box(x-2,y+51+aL,6,3,dark);
      if (walking) {
        box(x-2,y+54+aL,6,4,'#e4a780');
        if (!carry) { box(x+30,y+54+aR,5,4,'#e4a780'); box(x+30,y+51+aR,5,3,dark); }
      }
      // The pixel head is the default; the portrait crop remains as an explicit option.
      if (!avatar?.portraitHead) { head(x,y-8,box); return; }
      const silhouette = [
        [28,7],[38,7],[38,8],[43,8],[43,11],[45,11],[45,16],[46,16],
        [46,24],[44,24],[44,26],[47,26],[47,37],[45,37],[45,40],[43,40],
        [43,44],[42,44],[42,46],[41,46],[41,47],[40,47],[40,54],[25,54],
        [25,48],[23,48],[23,45],[22,45],[22,44],[21,44],[21,39],[19,39],
        [19,36],[17,36],[17,17],[19,17],[19,12],[23,12],[23,9],[28,9],
      ];
      ctx.save(); ctx.beginPath();
      silhouette.forEach(([sx,sy],i) => {
        if (i===0) ctx.moveTo(x+sx-16,y+sy-15);
        else ctx.lineTo(x+sx-16,y+sy-15);
      });
      ctx.closePath(); ctx.clip(); ctx.drawImage(avatar,16,7,32,47,x,y-8,32,47); ctx.restore();
      return;
    }
    box(x+11,y+24,10,8,'#ad796b'); box(x+11,y+24,10,3,'#8c6a5e'); box(x+2,y+30,28,26,color);
    // Torso shading: lit left edge, shaded right edge, hem and fold creases.
    box(x+2,y+32,2,22,light); box(x+26,y+32,4,24,dark); box(x+2,y+50,28,6,dark);
    box(x+8,y+40,4,1,dark); box(x+20,y+44,5,1,dark); box(x+6,y+46,3,1,dark);
    box(x+6,y+30,6,4,'#f5eae2'); box(x+20,y+30,6,4,'#f5eae2');
    box(x+7,y+33,4,1,'#c9c4d5'); box(x+21,y+33,4,1,'#c9c4d5');
    box(x+14,y+36,4,18,'#765466'); box(x+14,y+36,1,18,'#8c6262');
    box(x+2,y+52,28,3,'#392b35'); box(x+14,y+52,4,3,'#efc68e');
    // Role gear sits under the arms so sleeves overlap it naturally.
    if (id==='scout') {
      box(x+3,y+31,3,24,'#49303e'); box(x+3,y+31,1,24,'#765466');
      box(x+25,y+44,9,9,'#8c6262'); box(x+25,y+44,9,3,'#a67a6e'); box(x+28,y+46,3,2,'#efc68e');
    } else if (id==='writer') {
      box(x+21,y+38,6,6,dark); box(x+22,y+36,1,4,'#c875a1'); box(x+24,y+36,1,4,'#9bd4cd');
    } else {
      box(x+6,y+33,3,16,dark); box(x+23,y+33,3,16,dark);
      box(x+21,y+42,6,6,light); box(x+23,y+40,1,3,'#c875a1');
    }
    // Sleeves with cuffs; the swing makes one hand lead and the other trail.
    const aL=walking ? arm : 0, aR=walking && !carry ? -arm : 0, cuff='#f5eae2';
    box(x-4,y+34,8,18+aL,color); box(x-4,y+34,2,18+aL,light); box(x-4,y+49+aL,8,3,cuff);
    box(x+28,y+34,8,18+aR,color); box(x+34,y+34,2,18+aR,dark); box(x+28,y+49+aR,8,3,cuff);
    if (walking) {
      box(x-3,y+52+aL,6,4,'#efc3a1'); box(x-3,y+55+aL,6,1,'#d5a88e');
      if (!carry) { box(x+29,y+52+aR,6,4,'#efc3a1'); box(x+29,y+55+aR,6,1,'#d5a88e'); }
    }
    box(x+6,y-2,20,28,'#ad796b');
    box(x+2,y+6,28,16,'#d5a88e'); box(x+6,y+2,18,22,'#efc3a1');
    // Ears, cheeks, jaw shade and brows; eyes get a glint so they read as alive.
    box(x+3,y+11,2,5,'#ad796b'); box(x+27,y+11,2,5,'#ad796b');
    box(x+6,y+22,18,2,'#d5a88e'); box(x+8,y+19,3,2,'#e8a99a'); box(x+21,y+19,3,2,'#e8a99a');
    box(x+8,y+8,6,2,'#f5d9bc'); box(x+8,y+12,6,2,'#623f43');
    box(x+20,y+12,5,2,'#623f43'); box(x+10,y+15,2,3,'#1A1218');
    box(x+22,y+15,2,3,'#1A1218'); box(x+10,y+15,1,1,'#f5eae2'); box(x+22,y+15,1,1,'#f5eae2');
    box(x+16,y+18,3,3,'#ad796b'); box(x+17,y+17,1,2,'#f5d9bc');
    box(x+12,y+24,8,2,'#8c6262'); box(x+13,y+24,6,1,'#a8706a');
    if (id==='scout') {
      box(x+4,y-4,22,8,'#45616a'); box(x,y+2,32,5,'#9bd4cd');
      box(x+14,y-2,6,4,'#efc68e'); box(x+2,y+7,4,8,'#49303e');
      box(x+6,y-3,10,1,'#5d808a'); box(x,y+6,32,1,'#7bb3ad'); box(x+4,y+7,24,1,'#b88e78');
      box(x+25,y+7,3,5,'#49303e'); box(x+15,y-1,4,1,'#c8a56e');
    } else if (id==='writer') {
      box(x+6,y-4,18,6,'#49303e'); box(x+2,y,10,10,'#623f43');
      box(x+8,y-2,12,3,'#8c6262'); box(x+24,y+2,4,10,'#49303e');
      box(x+28,y+10,2,12,'#efc68e');
      // Round frames with pupils inside, a bridge, temples and hair strands.
      box(x+7,y+13,9,7,'#49303e'); box(x+8,y+14,7,5,'#efc3a1');
      box(x+18,y+13,9,7,'#49303e'); box(x+19,y+14,7,5,'#efc3a1');
      box(x+16,y+15,2,1,'#49303e'); box(x+5,y+14,2,1,'#49303e'); box(x+27,y+14,2,1,'#49303e');
      box(x+10,y+15,2,3,'#1A1218'); box(x+22,y+15,2,3,'#1A1218'); box(x+8,y+14,2,1,'#f5eae2');
      box(x+4,y+1,2,8,'#49303e'); box(x+12,y-3,6,1,'#623f43'); box(x+9,y+2,5,1,'#623f43');
      box(x+28,y+8,2,2,'#c875a1');
    } else {
      box(x+6,y-4,20,6,'#c9c4d5'); box(x+2,y,24,6,'#e3deeb');
      box(x+8,y,12,2,'#f5eae2'); box(x+2,y+6,6,6,'#c9c4d5');
      box(x+26,y+2,4,20,'#9691ac'); box(x+28,y+18,4,10,'#c3b4ed');
      // Strand lines, a side parting and a shaded ponytail.
      box(x+10,y-4,1,5,'#e3deeb'); box(x+16,y-3,1,4,'#b0aac3'); box(x+4,y+2,1,5,'#b0aac3');
      box(x+24,y+6,2,10,'#c9c4d5'); box(x+29,y+3,1,17,'#7d7894'); box(x+29,y+19,3,2,'#c875a1');
    }
  }
  function workstation(d, pose) {
    const {x,y}=d;
    box(x+4,y+102,104,12,'#392b35');
    if (pose?.away || pose?.hidden) chair(x+38,y+8);
    else actor(x+38,y+8+(pose?.bob??0),d.color,d.id);
    box(x+8,y+84,8,22,'#8c6262'); box(x+92,y+84,8,22,'#8c6262');
    box(x,y+70,108,20,'#946b68'); box(x,y+58,108,24,'#cda28a');
    box(x,y+58,108,4,'#efd3af'); box(x+34,y+64,40,6,'#f5eae2');
    for (let key=0;key<7;key++) box(x+37+key*5,y+66,2,2,'#765466');
    // Desk edge shading, drawer fronts and per-role desk props.
    box(x,y+82,108,2,'#7a5a58'); box(x,y+62,2,20,'#e0bfa8'); box(x+106,y+62,2,20,'#b88e78');
    for (const dx of [6,82]) {
      box(x+dx,y+86,20,3,'#8c6262'); box(x+dx+8,y+87,4,1,'#efc68e');
    }
    const key=pose?.hand ? 1 : 0;
    if (d.id==='orchestrator') {
      box(x+8,y+54,6,7,'#f5eae2'); box(x+14,y+56,2,3,'#f5eae2'); box(x+9,y+55,4,2,'#76492e');
      box(x+9,y+50,1,3,'#c9c4d5'); box(x+12,y+48-key,1,4,'#c9c4d5');
      box(x+88,y+58,12,3,'#514353'); box(x+90,y+55,8,3,'#f5eae2');
    } else if (d.id==='scout') {
      box(x+8,y+54,10,8,'#8c6262'); box(x+6,y+52,14,3,'#cda28a');
      box(x+9,y+44,2,9,'#6f9a7c'); box(x+13,y+42,2,11,'#4d7a63'); box(x+16,y+47,2,6,'#8fbf94');
      box(x+88,y+55,10,6,'#9bd4cd'); box(x+89,y+56,8,1,'#f5eae2');
    } else if (d.id==='writer') {
      box(x+8,y+52,9,10,'#49303e'); box(x+9,y+46,1,7,'#efc68e'); box(x+12,y+44,1,9,'#c875a1');
      box(x+14,y+47,1,6,'#9bd4cd');
      box(x+84,y+57,16,4,'#f5eae2'); box(x+86,y+54,14,3,'#fff4d6'); box(x+84,y+60,16,1,'#c9c4d5');
    } else {
      box(x+8,y+54,6,7,'#f5eae2'); box(x+14,y+56,2,3,'#f5eae2'); box(x+9,y+55,4,2,'#9bd4cd');
      box(x+86,y+54,5,5,'#efc68e'); box(x+92,y+55,5,5,'#c875a1'); box(x+88,y+59,10,2,'#c9c4d5');
    }
    const act=!pose?.away && !pose?.hidden && actions[pose?.tool?.kind];
    if (act) act(x,y,Math.floor(pose.tool.t*6),d.color);
    else if (!pose?.away && !pose?.hidden) {
      box(x+34,y+54,8,10,d.color); box(x+66,y+54,8,10,d.color);
      box(x+36,y+62,10,4,'#765466'); box(x+62,y+62,10,4,'#765466');
      box(x+40,y+62-(pose?.hand??0),10,5,'#efc3a1');
      box(x+58,y+62-(pose?.working?1-pose.hand:0),10,5,'#efc3a1');
    }
    box(x+44,y+88,20,2,'#765466'); box(x+51,y+84,6,4,'#392b35');
    box(x+32,y+70,44,18,'#1A1218'); box(x+34,y+72,40,13,'#514353');
    box(x+35,y+72,38,2,'#765466');
    if (pose?.working && !act) {
      // Screen text scrolls with each typing beat.
      for (let line=0;line<3;line++)
        box(x+37+(line+key)%2*2,y+76+line*3,[18,24,12][(line+key)%3],1,line===2?'#9bd4cd':'#9691ac');
    } else if (!pose?.away && !pose?.hidden) box(x+37,y+77,10,1,'#625066');
    for (let vent=0;vent<4;vent++) box(x+45+vent*5,y+80,3,2,'#392b35');
    if (pose?.working && !act) {
      box(x+36,y+75,2,2,pose.hand?'#9bd4cd':'#45616a');
      box(x+35,y+72,38,1,pose.hand?'#b894ac':'#765466');
      const py=y+35-(Number.isFinite(pose.phase) ? pose.phase%4 : key*2)*3;
      box(x+80,py,2,2,d.color); box(x+85,py-5,1,3,d.color);
    }
    if (pose?.error) {
      // Small pixel warning above the monitor, independent of typing/away state.
      box(x+80,y+48,9,15,'#392b35');
      box(x+83,y+50,3,7,'#efc68e'); box(x+83,y+59,3,2,'#efc68e');
    }
    if (pose?.gesture) {
      box(x+70,y+44,6,12,d.color); box(x+72,y+34,6,12,'#efc3a1');
      box(x+76,y+34,10,3,'#efc3a1');
    }
  }
  function furnishings() {
    shelf(300,72,116,true); shelf(460,72,116,true); shelf(492,266,100,false);
    box(492,366,100,24,'#cda28a'); box(504,358,28,12,'#f5eae2'); box(540,362,32,4,'#c3b4ed');
  }
  function ring(cx,cy,r,color,fill) {
    for (let dy=-r-1;dy<=r+1;dy++) for (let dx=-r-1;dx<=r+1;dx++) {
      const d=Math.hypot(dx,dy);
      if (fill && d<r-.5) box(cx+dx,cy+dy,1,1,fill);
      else if (Math.abs(d-r)<.6) box(cx+dx,cy+dy,1,1,color);
    }
  }
  function ray(x,y,angle,length,color,w=2) {
    for (let i=0;i<length;i++) box(Math.round(x+Math.cos(angle)*i),Math.round(y+Math.sin(angle)*i),w,w,color);
  }
  // Seated tool gestures: the orchestrator's hands and a desk prop act out each tool.
  // (x,y) is the desk origin; the torso shows above the desk top at y+46..y+58.
  const skin='#efc3a1';
  const actions = {
    bash(x,y,f,c) {
      box(x+34,y+54,8,10,c); box(x+66,y+54,8,10,c);
      box(x+40,y+62-(f%2)*2,10,5,skin); box(x+58,y+60+(f%2)*2,10,5,skin);
      // Terminal output streams up from the machine while keys clatter.
      for (let i=0;i<4;i++) {
        const py=y+54-((f+i*3)%12)*3, w=[6,3,8,4][i];
        box(x+80,py,2,2,'#9bd4cd'); box(x+83,py,w,2,'#45616a');
      }
    },
    read(x,y,f,c) {
      box(x+36,y+44,36,18,'#8c6262');
      box(x+37,y+42,16,18,'#f5eae2'); box(x+55,y+42,16,18,'#f5eae2'); box(x+53,y+42,2,19,'#765466');
      for (let i=0;i<4;i++) { box(x+39,y+46+i*3,11,1,'#765466'); box(x+57,y+46+i*3,11,1,'#765466'); }
      const turn=[14,9,4,0][f%4];
      if (turn) { box(x+55,y+41,turn,18,'#fff4d6'); box(x+54+turn,y+41,1,18,'#cda28a'); }
      box(x+30,y+50,6,12,c); box(x+72,y+50,6,12,c);
      box(x+32,y+50,6,5,skin); box(x+70,y+50,6,5,skin);
    },
    grep(x,y,f,c) {
      box(x+28,y+59,52,9,'#f5eae2');
      const hit=Math.floor(f/4)%3;
      for (let i=0;i<3;i++) box(x+31,y+60+i*3,[40,30,44][i],1,i===hit?'#c875a1':'#b894ac');
      box(x+34,y+54,8,10,c); box(x+40,y+62,10,5,skin);
      // The lens sweeps along the highlighted line, the hand following it.
      const cx=x+34+(f%8)*5, cy=y+60+hit*3;
      ring(cx,cy,4,'#49303e'); ray(cx+3,cy+3,Math.PI/4,5,'#8c6262');
      box(cx+6,cy+4,7,5,skin); box(cx+10,cy-2,6,8,c);
    },
    ls(x,y,f,c) {
      box(x+34,y+58,34,10,'#efc68e'); box(x+34,y+56,12,3,'#cda28a');
      // Files pop out of the open folder one by one.
      for (let i=0;i<3;i++) {
        const up=i===f%3 ? 8 : 2;
        box(x+38+i*9,y+56-up,7,9,['#f5eae2','#9bd4cd','#c3b4ed'][i]);
      }
      box(x+34,y+60,34,8,'#f5d9bc');
      box(x+28,y+54,8,10,c); box(x+70,y+54,8,10,c);
      box(x+30,y+60,6,5,skin); box(x+68,y+60,6,5,skin);
    },
    find(x,y,f,c) {
      box(x+32,y+42,44,18,'#efd3af');
      for (let i=1;i<4;i++) box(x+32+i*11,y+42,1,18,'#cda28a');
      box(x+32,y+51,44,1,'#cda28a');
      box(x+36,y+46,14,1,'#9bd4cd'); box(x+50,y+46,1,8,'#9bd4cd'); box(x+50,y+54,18,1,'#9bd4cd');
      // A marker hops across the map while it searches.
      const [mx,my]=[[38,44],[48,48],[58,52],[68,46]][f%4];
      box(x+mx,y+my,3,3,'#c875a1');
      box(x+28,y+48,6,12,c); box(x+74,y+48,6,12,c);
      box(x+28,y+48,6,5,skin); box(x+74,y+48,6,5,skin);
    },
    edit(x,y,f,c) {
      box(x+44,y+60,10,6,'#514353'); box(x+47,y+62,4,2,'#9691ac');
      box(x+34,y+54,8,10,c); box(x+40,y+62,10,5,skin);
      // Right arm cranks a wrench on the bolt; sparks on each turn.
      const a=[-2.3,-2.0,-2.3,-2.6][f%4];
      box(x+66,y+50,8,12,c); box(x+62,y+56,8,5,skin);
      ray(x+62,y+58,a,14,'#c9c4d5',3);
      const hx=Math.round(x+62+Math.cos(a)*13), hy=Math.round(y+58+Math.sin(a)*13);
      box(hx-3,hy-3,7,7,'#c9c4d5'); box(hx-1,hy-3,3,3,'#1A1218');
      if (f%4===0) { box(x+56,y+56,2,2,'#efc68e'); box(x+42,y+57,2,2,'#efc68e'); }
    },
    write(x,y,f,c) {
      box(x+40,y+58,30,11,'#f5eae2'); box(x+40,y+58,30,1,'#c3b4ed');
      const step=f%16, line=Math.min(2,Math.floor(step/5)), prog=Math.min(22,(step-line*5)*5+2);
      for (let i=0;i<line;i++) box(x+43,y+61+i*3,22,1,'#49303e');
      box(x+43,y+61+line*3,prog,1,'#49303e');
      box(x+34,y+54,8,10,c); box(x+38,y+60,8,5,skin);
      // The pencil hand travels along the line it is writing.
      const px=x+43+prog;
      box(px+1,y+49+line*3,2,10,'#efc68e'); box(px+1,y+47+line*3,2,2,'#c875a1');
      box(px-1,y+56+line*3,7,5,skin); box(px+2,y+52+line*3,6,8,c);
    },
    web(x,y,f,c) {
      // Terminal base on desk
      box(x+44,y+60,20,6,'#392b35'); box(x+46,y+58,16,2,'#514353');
      // Antenna mast on right desk edge with radio pulses
      box(x+88,y+34,2,26,'#c9c4d5');
      box(x+87,y+32,4,3,f%4<2?'#c875a1':'#efc68e');
      const wave=f%3;
      if (wave===0) { box(x+83,y+30,2,2,'#9bd4cd'); box(x+93,y+30,2,2,'#9bd4cd'); }
      else if (wave===1) { box(x+80,y+27,2,2,'#9bd4cd'); box(x+96,y+27,2,2,'#9bd4cd'); }
      // Floating holographic browser window (32x16)
      box(x+38,y+40,32,16,'#1A1218'); box(x+39,y+41,30,14,'#45616a');
      box(x+39,y+41,30,3,'#514353'); box(x+41,y+42,2,1,'#c875a1'); box(x+44,y+42,20,1,'#9bd4cd');
      // Animated line loading
      const lines=1+(f%4);
      for (let i=0;i<lines;i++) {
        const w=[16,24,18,22][i];
        box(x+41,y+46+i*2,w,1,i===lines-1?'#9bd4cd':'#f5eae2');
      }
      box(x+34,y+54,8,10,c); box(x+66,y+54,8,10,c);
      box(x+38,y+58-(f%2),8,5,skin); box(x+62,y+56+(f%2),8,5,skin);
    },
  };
  // The Stacks reading table doubles as the review desk: diff sheets, lens, stamp.
  function reviewDesk(t, stamper=false) {
    box(492,366,100,24,'#cda28a'); box(492,366,100,3,'#efd3af');
    box(492,388,100,3,'#946b68'); box(496,391,6,8,'#8c6262'); box(582,391,6,8,'#8c6262');
    box(496,399,92,2,'#49303e'); box(582,356,8,8,'#f5eae2'); box(590,358,2,4,'#f5eae2'); box(583,357,6,2,'#9bd4cd');
    if (t==null) { box(504,358,28,12,'#f5eae2'); box(540,362,32,4,'#c3b4ed'); return; }
    const f=Math.floor(t*4);
    for (const [px,py] of [[498,352],[530,354]]) {
      box(px,py,28,18,'#f5eae2');
      for (let i=0;i<4;i++) box(px+3,py+3+i*4,[20,14,18,10][i],2,['#9bd4cd','#c875a1','#9bd4cd','#b894ac'][(i+px)%4]);
    }
    const lx=502+(f%8)*6;
    ring(lx,358,5,'#49303e'); ray(lx+4,362,Math.PI/4,5,'#8c6262');
    // Stamp lifts, then thumps a check onto the last sheet.
    const up=f%6<3;
    box(548,362,12,6,'#392b35'); box(549,363,10,3,'#c875a1');
    box(568,up?340:350,14,6,'#c875a1'); box(572,up?332:342,6,8,'#8c6262');
    // When the orchestrator stands behind the desk, it is their hand on the stamp.
    if (stamper) { box(576,up?328:338,8,10,desks[0].color); box(570,up?330:340,10,5,skin); }
    if (!up) { box(566,364,2,1,'#f5eae2'); box(584,364,2,1,'#f5eae2'); }
    if (!up) { box(569,368,3,2,'#45616a'); box(572,370,3,2,'#45616a'); box(575,366,3,2,'#45616a'); box(578,364,3,2,'#45616a'); }
  }
  // Potted plant, base at (x,y); leaves fan out above the pot.
  function plant(x,y,tall=1) {
    box(x+2,y+24,16,3,'#392b35');
    box(x+3,y+14,14,10,'#8c6262'); box(x+1,y+12,18,3,'#cda28a'); box(x+3,y+22,14,2,'#765466');
    box(x+4,y+15,2,8,'#a67a6e');
    box(x+9,y-8*tall,3,20*tall/1+0,'#4d7a63'); box(x+4,y+2-6*tall,4,14+6*tall,'#6f9a7c');
    box(x+12,y+1-6*tall,4,14+6*tall,'#6f9a7c'); box(x+1,y+6-3*tall,3,10+3*tall,'#8fbf94');
    box(x+16,y+5-3*tall,3,10+3*tall,'#8fbf94'); box(x+5,y+2-6*tall,1,6,'#8fbf94');
  }
  function props() {
    // Wall clock and window sills on the north wall.
    box(60,13,10,10,'#49303e'); box(61,14,8,8,'#f5eae2'); box(64,15,1,4,'#392b35'); box(64,18,3,1,'#c875a1');
    for (const x of [172,364,540]) { box(x-2,24,56,2,'#f5eae2'); box(x,14,52,1,'#5a4450'); }
    // Notice boards on the inner walls.
    box(40,184,18,8,'#8c6262'); box(41,185,16,6,'#cda28a'); box(43,186,4,4,'#f5eae2');
    box(49,186,4,3,'#9bd4cd'); box(54,187,2,3,'#c875a1');
    box(330,184,26,8,'#392b35'); box(332,186,10,1,'#9bd4cd'); box(332,188,16,1,'#efc68e'); box(332,190,8,1,'#c875a1');
    // Corridor runner under the review route, and the entrance mat.
    box(176,203,360,20,'#5d4a58'); box(176,203,360,2,'#cda28a'); box(176,221,360,2,'#cda28a');
    box(178,205,356,1,'#8c6262'); box(178,219,356,1,'#8c6262');
    for (let rx=190;rx<530;rx+=24) { box(rx,211,8,4,'#b894ac'); box(rx+3,209,2,8,'#b894ac'); }
    box(176,203,3,20,'#efd3af'); box(533,203,3,20,'#efd3af');
    box(284,394,40,10,'#5d4a58'); box(284,394,40,1,'#cda28a'); box(284,403,40,1,'#cda28a');
    for (let mx=288;mx<322;mx+=6) box(mx,397,3,4,'#8c6262');
    plant(24,150); plant(228,34); plant(592,126); plant(156,374,.6); plant(293,376,.6);
    plant(433,376,.6); plant(473,374,.6);
  }
  function room(withFurniture=true, lighting=null) {
    box(0,0,640,432,'#1A1218'); box(12,24,616,396,'#76636a');
    for (let y=28;y<420;y+=28) for (let x=16;x<628;x+=28) tile(x,y,x+26,y+26,x,y);
    for (const rect of walls) wall(...rect);
    floor(20,194,600,38);
    props();
    for (const [x,y,w,h] of [[140,182,44,12],[420,182,44,12],
      [180,232,44,15],[512,232,44,15],[276,408,56,12]]) {
      floor(x,y,w,h); box(x-3,y,3,h,'#8c6262'); box(x+w,y,3,h,'#8c6262');
      box(x-3,y,3,3,'#f5eae2'); box(x+w,y,3,3,'#f5eae2');
    }
    floor(456,300,12,44); box(456,297,12,3,'#8c6262'); box(456,344,12,3,'#8c6262');
    floor(256,104,12,44); box(256,101,12,3,'#8c6262'); box(256,148,12,3,'#8c6262');
    box(276,418,56,2,'#aa958e');
    for (const x of [172,364,540]) {
      box(x,14,52,10,'#49303e'); box(x+2,16,48,6,lighting?.sky ?? '#78939c');
      box(x+5,17,16,1,lighting?.reflection ?? '#b7c9ca'); box(x+30,17,16,1,lighting?.reflection ?? '#b7c9ca'); box(x+26,16,2,6,'#49303e');
    }
    if (lighting) for (const x of [100,340,548]) {
      box(x,28,24,3,'#49303e'); box(x+2,31,20,2,lighting.lamp);
      box(x+5,33,14,1,lighting.period === 'day' ? '#b894ac' : '#cda28a');
    }
    if (withFurniture) furnishings();
    ctx.font='bold 14px monospace'; ctx.fillStyle='#1A1218';
    for (const [label,x] of [['THE GENTLEMAN',44],['ENGRAM',300]]) ctx.fillText(label,x,48);
    ctx.font='bold 11px monospace';
    // Workshop name occupies the gap between chairs, below rest and transit.
    for (const [label,x,y] of [['THE WORKSHOP',122,342],['THE STACKS',480,258]]) ctx.fillText(label,x,y);
  }
  function bubble(agent) {
    const text=agent.text.toUpperCase(), w=text.length*7+8, h=15;
    const x=Math.max(2,Math.min(638-w,agent.head[0]-Math.floor(w/2)));
    const y=Math.max(2,agent.head[1]-23);
    box(x,y,w,h,'#392b35'); box(x+1,y+1,w-2,h-2,bubbleFill);
    const tail=Math.max(x+3,Math.min(x+w-5,agent.head[0]));
    box(tail-2,y+h,5,2,'#392b35'); box(tail-1,y+h,3,1,bubbleFill);
    box(tail-1,y+h+2,3,2,'#392b35'); box(tail,y+h+4,1,1,'#392b35');
    ctx.font='11px monospace'; ctx.fillStyle='#392b35'; ctx.fillText(text,x+4,y+11);
    return {text:agent.text,x,y,w,h,head:agent.head};
  }
  // Wood door panel in a wall gap; `swing` 0..1 sweeps its leaf open into the next room.
  function door(d, amount) {
    const {x,y,w,h,swing}=d;
    if (amount>0) {
      const part=Math.min(1,amount), leaf=Math.max(2,Math.round((swing==='right' ? 28 : 32)*part));
      if (swing==='right') {
        // The panel folds towards its top hinge while the leaf swings out.
        const rest=Math.round(h*(1-part));
        if (rest>0) { box(x,y,w,rest,'#946b68'); box(x,y,3,rest,'#cda28a'); box(x,y+rest,w,2,'#5a4450'); }
        box(x+w,y,leaf,3,'#946b68'); box(x+w,y,leaf,1,'#cda28a');
        box(x+w,y+3,leaf,2,'#5a4450'); if (part>=1) box(x+w+22,y+1,2,1,'#efc68e');
        box(x+w-1,y,2,3,'#c9c4d5');
      } else {
        // Hinged on the right edge so leaves stay clear of room labels.
        const rest=Math.round(w*(1-part)), top=swing==='down' ? y+h : y-leaf;
        if (rest>0) {
          box(x+w-rest,y,rest,h,'#946b68'); box(x+w-rest,y,rest,2,'#cda28a');
          box(x+w-rest,y+h,rest,2,'#49303e');
        }
        box(x+w-5,top,5,leaf,'#946b68'); box(x+w-5,top,2,leaf,'#cda28a');
        box(x+w-8,top,3,leaf,'#5a4450'); if (part>=1) box(x+w-4,top+26,2,2,'#efc68e');
        box(x+w-6,y+(h>>1)-2,3,2,'#c9c4d5');
      }
      return;
    }
    if (swing==='right') {
      box(x,y,w,h,'#946b68'); box(x,y,3,h,'#cda28a');
      box(x+4,y+4,5,h/2-6,'#8c6262'); box(x+4,y+h/2+2,5,h/2-6,'#8c6262');
      box(x+6,y+h/2-1,2,2,'#efc68e'); box(x+w,y,2,h,'#49303e');
      box(x+4,y+4,1,h/2-6,'#7a5252'); box(x+4,y+h/2+2,1,h/2-6,'#7a5252'); box(x+w-1,y,1,h,'#7a5a58');
      return;
    }
    // Double doors split wide gaps; each leaf gets its own inset panel and knob.
    const leaves=w>48 ? [[x,w/2],[x+w/2,w/2]] : [[x,w]];
    for (const [lx,lw] of leaves) {
      box(lx,y,lw,h,'#946b68'); box(lx,y,lw,2,'#cda28a');
      box(lx+4,y+3,lw/2-6,h-5,'#8c6262'); box(lx+lw/2+2,y+3,lw/2-6,h-5,'#8c6262');
      box(lx+lw/2-1,y+h/2-1,2,2,'#efc68e');
      box(lx+4,y+3,lw/2-6,1,'#7a5252'); box(lx+lw/2+2,y+3,lw/2-6,1,'#7a5252');
      box(lx+1,y+h-2,lw-2,1,'#7a5a58');
    }
    box(x,y+h,w,2,'#49303e');
  }
  function render(state=null, {actors=true}={}) {
    room(!state, state?.lighting);
    const layers = desks.map(d=>({depth:d.y+106, draw:()=>workstation(d,actors?(state?.agents[d.id]):{hidden:true})}));
    if (state) {
      const poses = Object.values(state.agents ?? {});
      for (const d of doors) {
        const amount = Math.max(0, ...poses.map(p => doorSwing(d, p)));
        const depth = amount>0 && d.swing==='right' ? d.y : d.y+d.h;
        layers.push({depth, draw:()=>door(d, amount)});
      }
    }
    if (state) layers.push(
      {depth:136,draw:()=>{shelf(300,72,116,true); shelf(460,72,116,true);}},
      {depth:330,draw:()=>shelf(492,266,100,false)},
      {depth:390,draw:()=>reviewDesk(state.review ? state.review.t : null, !!state.review?.stamper)},
      {depth:318,draw:()=>{
        // Shared water corner, separate from the aligned desk/chair row.
        box(166,280,28,36,'#cda28a'); box(168,280,24,3,'#efd3af');
        box(172,264,16,16,'#9bd4cd'); box(174,262,12,3,'#f5eae2');
        box(178,284,4,6,'#49303e'); box(176,296,8,8,'#f5eae2');
        box(166,280,2,36,'#e0bfa8'); box(192,280,2,36,'#b88e78'); box(166,314,28,2,'#946b68');
        box(174,266,2,10,'#d6efec'); box(172,286,3,2,'#c875a1'); box(185,286,3,2,'#9bd4cd');
        box(189,274,4,6,'#f5eae2'); box(170,306,20,1,'#a67a6e');
      }}
    );
    if (state && actors) {
      for (const {id} of desks) {
        const pose = state.agents[id];
        if (pose?.away) {
          const [x,y] = pose.position.map(Math.round);
          layers.push({depth:y+68, draw:()=>standing(x,y,Math.round(pose.stride),pose.book,id,pose.drinking)});
        }
      }
      layers.sort((a,b)=>a.depth-b.depth).forEach(l=>l.draw());
      // Live bubbles are accessible, device-resolution HTML overlays.
      return [];
    }
    layers.sort((a,b)=>a.depth-b.depth).forEach(l=>l.draw());
    return [];
  }
  function standing(x,y,stride=0,book=false,id='scout',drinking=false) {
    const color=desks.find(d=>d.id===id).color, carry=book||drinking;
    // Contact shadow keeps the walker grounded on the tiles.
    box(x+2,y+67,28,3,'#5f4e55'); box(x+5,y+70,22,1,'#5f4e55');
    actor(x,y,color,id,false,box,Math.round(stride*1.5),carry);
    const pants={orchestrator:'#49303e',scout:'#3b4f57',writer:'#5a4450',verifier:'#514a6a'}[id] ?? '#49303e';
    // The planted leg is longer; the lifted one tucks its cuff and shoe up.
    box(x+6,y+56,8,10-stride,pants); box(x+20,y+56,8,10+stride,pants);
    box(x+12,y+56,2,10-stride,shade(pants,-.25)); box(x+20,y+56,2,10+stride,shade(pants,-.25));
    box(x+6,y+56,1,10-stride,shade(pants,.2)); box(x+27,y+56,1,10+stride,shade(pants,.2));
    box(x+6,y+62-stride,8,1,shade(pants,.25)); box(x+20,y+62+stride,8,1,shade(pants,.25));
    box(x+4,y+64-stride,10,4,'#241923'); box(x+20,y+64+stride,10,4,'#241923');
    box(x+4,y+64-stride,10,1,'#3a2c38'); box(x+20,y+64+stride,10,1,'#3a2c38');
    box(x+4,y+67-stride,10,1,'#1A1218'); box(x+20,y+67+stride,10,1,'#1A1218');
    if (drinking) {
      box(x+27,y+28,8,8,color); box(x+27,y+28,2,8,shade(color,.16));
      box(x+26,y+24,8,5,'#efc3a1');
      box(x+23,y+18,8,10,'#f5eae2'); box(x+24,y+19,6,2,'#9bd4cd');
      box(x+31,y+20,3,6,'#f5eae2'); box(x+23,y+26,8,2,'#d6cbc0'); box(x+25,y+14,1,3,'#f5eae2');
    }
    if (book) {
      // Held book bobs a pixel on each planted step.
      const dy=Math.abs(stride)===2 ? -1 : 0;
      box(x+26,y+38+dy,12,16,'#efc68e'); box(x+29,y+41+dy,6,3,'#f5eae2');
      box(x+26,y+38+dy,2,16,'#cda28a'); box(x+28,y+52+dy,10,2,'#f5eae2');
      box(x+36,y+38+dy,2,14,'#d9a96f'); box(x+30,y+46+dy,4,1,'#cda28a');
      box(x+24,y+48+dy,8,4,'#efc3a1'); box(x+24,y+51+dy,8,1,'#d5a88e');
    }
  }
  return {render,room,actor,standing};
}

// Orchestrator walks behind its desk straight through the Bridge-Engram door and
// keeps going along the front of the first shelf to stand between both shelves.
export const memoryRoute = [[134,64], [276,72], [426,78]];
// Scout steps back through the shared lane. Depth ordering permits brief body
// overlap, but feet clear resting workers/water before the Workshop-Stacks door.
export const stacksRoute = [[78,302], [78,187], [426,187], [426,240], [462,240], [462,276], [526,276]];
// Verifier steps back from desk 3 into the lane and enters The Stacks to inspect references.
export const verifierStacksRoute = [[358,302], [358,187], [426,187], [426,240], [462,240], [462,276], [526,276]];

// Seconds and scene coordinates, independent of SSE frequency.
export function makeWalker(route, speed=72) {
  const distances = route.slice(1).map(([x,y],i) => Math.hypot(x-route[i][0], y-route[i][1]));
  const travelSeconds = distances.reduce((a,b)=>a+b,0) / speed;
  function position(seconds) {
    let distance = Math.max(0, seconds) * speed;
    for (let i=0; i<distances.length; i++) {
      const length = distances[i];
      if (distance <= length) {
        const [x,y] = route[i], [nx,ny] = route[i+1];
        if (!length) continue;
        return [x+(nx-x)*distance/length, y+(ny-y)*distance/length];
      }
      distance -= length;
    }
    return [...route.at(-1)];
  }
  // Pure journey state: a short activity still finishes the outward trip. Renewed
  // activity reverses a return at its current position without teleporting.
  function step(previous, active, deltaSeconds) {
    let {phase, progress} = previous ?? {phase:'seated', progress:0};
    let remaining = Math.max(0, deltaSeconds);
    if (active && (phase==='seated' || phase==='returning')) phase = 'outbound';
    if (phase==='outbound') {
      const moved = Math.min(remaining, travelSeconds-progress);
      progress += moved;
      remaining -= moved;
      if (progress >= travelSeconds) phase = 'shelf';
    }
    if (phase==='shelf' && !active) phase = 'returning';
    if (phase==='returning') {
      progress = Math.max(0, progress-remaining);
      if (progress===0) phase = 'seated';
    }
    const away = phase!=='seated';
    return {
      phase, progress, away, position:position(progress), book:phase==='shelf',
      stride:away && phase!=='shelf' ? Math.sin(progress*16)*2 : 0,
    };
  }
  return {route, travelSeconds, position, step};
}
// Orchestrator rounds its desk, leaves the Bridge, follows the corridor and
// enters The Stacks to stand behind the review desk, stamp in hand.
export const reviewRoute = [[134,64], [60,64], [60,106], [150,106], [150,146], [526,146], [526,276], [548,276]];
export const reviewWalker = makeWalker(reviewRoute, 110);
const memoryWalker = makeWalker(memoryRoute);
export const memoryTravelSeconds = memoryWalker.travelSeconds;
export const memoryPosition = memoryWalker.position;
export const memoryWalk = memoryWalker.step;

// One controller per office. Snapshot action identity survives fast tool results,
// but never a settled turn. Travel survives disconnect/session changes so bodies
// return along their route rather than snapping back to their desks.
export function createActionGesture() {
  let identity = null, kind = null, label = null, since = 0;
  let walk = null, reviewWalk = null;
  function observe(snapshot, now) {
    const parent = snapshot?.orchestrator;
    const action = parent?.action;
    const next = snapshot?.session && parent?.working && action
      ? `${snapshot.epoch}:${action.count}` : null;
    if (next !== identity) since = now;
    identity = next;
    kind = next ? action.kind : null;
    label = next ? action.label : null;
  }
  function disconnect() { identity = null; kind = null; label = null; }
  function travel(walker, previous, active, delta) {
    // Unlike worker excursions, cancelled parent trips turn back immediately.
    if (!active && previous?.phase === 'outbound') previous = {...previous, phase:'returning'};
    return walker.step(previous, active, delta);
  }
  function step(now, delta) {
    walk = travel(memoryWalker, walk, kind === 'memory' && !reviewWalk?.away, delta);
    reviewWalk = travel(reviewWalker, reviewWalk, kind === 'review' && !walk.away, delta);
    const trip = walk.away ? walk : reviewWalk.away ? {...reviewWalk, book:false} : walk;
    const t = (now - since) / 1000;
    return {walk, reviewWalk, trip, label,
      tool:kind && !['memory', 'review'].includes(kind) ? {kind, t} : null,
      review:kind === 'review' && reviewWalk.phase === 'shelf' ? {t, stamper:true} : null};
  }
  return {observe, disconnect, step};
}
export const stacksWalker = makeWalker(stacksRoute);

// A single group beside the water. Scout rests behind its OWN empty chair;
// when seated, that resting spot is vacant. Other resting bodies clear its seat.
// Vertical approaches and the lane at y=187 keep all feet separate.
export const restPositions = {scout:[74,246], writer:[30,246], verifier:[122,246]};
// Water dispenser position where tired workers refresh
export const waterPosition = [194,246];
export const toWaterRoute = [
  [210,108], [146,110], [146,145], [186,145], [186,187], [194,187], waterPosition
];
// Retrace the clear vertical approach before crossing above resting feet.
export const waterToRestRoute = role => [waterPosition, [194,187], [restPositions[role][0],187], restPositions[role]];
// label. Transit may briefly overlap projected silhouettes, just like the art.
export function bubbleAnchor(role, pose={}) {
  const d = desks.find(d => d.id === role);
  const [x,y] = pose.away ? pose.position : [d.x+38,d.y+8];
  if (role === 'orchestrator') return pose.away
    ? [Math.max(20,Math.min(520,x-30)),y+74,100,30] : [24,72,100,30];
  if (x > 180 && x < 250 && y < 150) return [174,70,78,32];
  if (!pose.away) return role === 'scout' ? [20,318,48,32]
    : [x-20,264,100,32];
  if (pose.phase === 'stacks' && !pose.moving) return [468,336,54,22];
  if (pose.phase === 'rest' && !pose.moving) return [{writer:22,scout:102,verifier:182}[role],198,78,32];
  return [Math.max(20,Math.min(520,x-34)),Math.max(26,y-38),100,32];
}
// Front-right customer corner: entire body clears the desk, room wall and door.
export const visitorPosition = [210,108];
export const standingBox = ([x,y]) => [x-4,y-4,42,74];
// Feet cross the existing Workshop and Bridge gaps; no entrance spawn.
export function lifecycleRoute(role, type) {
  const d = desks.find(d => d.id === role);
  const seat = [d.x + 38, d.y + 8];
  return type === 'arrival'
    ? [restPositions[role], [restPositions[role][0],187], [seat[0],187], seat]
    : [seat, [seat[0],187], [186,187], [186,145], [146,145], [146,110], visitorPosition];
}
export const resultLabels = {completed:'Result received', failed:'Error received',
  aborted:'Task cancelled', blocked:'Needs attention', partial:'Partial result'};
// Snapshot cursor: initial/reconnected sessions establish a baseline, never replay it.
export function observeLifecycle(previous, snapshot) {
  const reset = !previous || previous.epoch !== snapshot.epoch || snapshot.sequence < previous.sequence;
  return {epoch:snapshot.epoch, sequence:snapshot.sequence,
    events:reset ? [] : (snapshot.events ?? []).filter(e => e.sequence > previous.sequence), reset};
}
// Per-office feedback cursor. Baselines/reconnects never replay old failures.
export function createErrorFeedback() {
  let previous = null, until = 0;
  return {
    reset() { previous = null; until = 0; },
    observe(snapshot, now) {
      const count = snapshot.orchestrator?.errorCount ?? 0;
      const baseline = !previous || previous.epoch !== snapshot.epoch
        || snapshot.sequence < previous.sequence || count < previous.count || !snapshot.session;
      if (baseline) until = 0;
      else if (count > previous.count) until = now + 2500;
      previous = {epoch:snapshot.epoch, sequence:snapshot.sequence, count};
    },
    active(now) { return now < until; },
  };
}
export function stepJourney(previous, event, delta) {
  const journey = previous ?? {event, elapsed:0};
  const walker = makeWalker(lifecycleRoute(journey.event.role, journey.event.type));
  const elapsed = journey.elapsed + Math.max(0, delta);
  const arrival = journey.event.type === 'arrival';
  const total = arrival ? walker.travelSeconds : walker.travelSeconds * 2 + 1.5;
  const progress = arrival ? elapsed : elapsed <= walker.travelSeconds + 1.5
    ? Math.min(elapsed, walker.travelSeconds) : total - elapsed;
  const holding = !arrival && elapsed > walker.travelSeconds && elapsed <= walker.travelSeconds + 1.5;
  return {...journey, elapsed, done:elapsed >= total, away:elapsed < total,
    position:walker.position(progress),
    // Legs move only while travelling, not during the delivery hold.
    stride:holding ? 0 : Math.sin(elapsed * 16) * 2,
    book:!arrival, text:arrival ? 'Arriving' : resultLabels[journey.event.state] ?? 'Result received'};
}

// One persistent actor per role. Snapshots describe work; only observed events
// authorize arrivals/results. Routes are never replaced with an entrance spawn.
export function createWorkers() {
  const workers = Object.fromEntries(Object.entries(restPositions).map(([role, position]) =>
    [role, {position:[...position], phase:'rest', queue:[], motion:null, result:null}]));
  let visitor = null;
  const start = (w, route, phase) => {
    w.motion = {route, walker:makeWalker(route), elapsed:0, from:w.phase, to:phase};
  };
  const reset = () => {
    visitor = null;
    for (const w of Object.values(workers)) {
      w.queue = []; w.result = null;
      // Retrace only the already travelled prefix, not a shortcut through walls.
      if (w.motion) {
        const m = w.motion;
        // Homeward travel already follows a safe route. Repeated baselines must
        // not reverse it again, especially back towards the visitor after delivery.
        if (m.resetReturn || m.to === 'rest' || m.to === 'water' || m.from === 'water' || m.from === 'pause' || m.from === 'stacks') continue;
        const prefix = [m.route[0]];
        let distance = 0;
        for (let i=1;i<m.route.length;i++) {
          distance += Math.hypot(m.route[i][0]-m.route[i-1][0], m.route[i][1]-m.route[i-1][1]);
          if (distance > m.elapsed*72) break;
          prefix.push(m.route[i]);
        }
        start(w, [[...w.position], ...prefix.reverse()], m.from);
        w.motion.resetReturn = true;
      }
    }
  };
  function observe(events) {
    for (const event of events) workers[event.role]?.queue.push(event);
  }
  function step(delta, activeRoles=[], connected=true) {
    const dt = connected ? Math.max(0, Math.min(delta, .1)) : 0;
    const poses = {};
    for (const [role,w] of Object.entries(workers)) {
      const active = activeRoles.includes(role);
      const arrival = lifecycleRoute(role, 'arrival');
      const delivery = lifecycleRoute(role, 'result');
      if (!w.motion && (w.phase === 'pause' || w.phase === 'water')) w.pause = Math.max(0, w.pause - dt);
      // One moving worker at a time keeps narrow shared footpaths clear in both
      // directions. Stationary sprites may occlude a passer-by, never their feet.
      if (connected && !w.motion && !Object.values(workers).some(other => other.motion)) {
        if (w.phase === 'pause') {
          if (w.pause <= 1e-9) {
            // Delivery is acknowledged here; neither the book nor visitor lock
            // belongs to the subsequent refresh trip.
            w.result = null;
            if (visitor === role) visitor = null;
            start(w, toWaterRoute, 'water');
          }
        } else if (w.phase === 'water') {
          if (w.pause <= 1e-9) start(w, waterToRestRoute(role), 'rest');
        } else if (w.phase === 'stacks') {
          const route = role === 'verifier' ? verifierStacksRoute : stacksRoute;
          if (w.queue.length || !active) start(w, [...route].reverse(), 'seat');
        } else if (w.phase === 'rest') {
          if (w.queue.length || active) start(w, arrival, 'seat');
        } else if (w.phase === 'seat') {
          if (visitor === role) visitor = null;
          w.result = null;
          // Same-role parallel tasks share one visible actor, not extra sprites.
          while (w.queue[0]?.type === 'arrival') w.queue.shift();
          if (w.queue[0]?.type === 'result') {
            if (!visitor) {
              visitor = role; w.result = w.queue.shift();
              start(w, delivery, 'pause');
            }
          } else if (active && (role === 'scout' || role === 'verifier')) {
            start(w, role === 'verifier' ? verifierStacksRoute : stacksRoute, 'stacks');
          } else if (!active) start(w, [...arrival].reverse(), 'rest');
        }
      }
      const m = w.motion;
      if (m && connected) {
        m.elapsed = Math.min(m.walker.travelSeconds, m.elapsed + dt);
        w.position = m.walker.position(m.elapsed);
        if (m.elapsed >= m.walker.travelSeconds) {
          w.phase = m.to; w.motion = null;
          if (w.phase === 'pause') w.pause = 1.5;
          if (w.phase === 'water') w.pause = 2.0;
          if (w.phase === 'rest' && visitor === role) visitor = null;
        }
      }
      const away = !!w.motion || w.phase !== 'seat';
      poses[role] = {position:[...w.position], away, moving:!!w.motion, phase:w.phase,
        stride:w.motion ? Math.sin(w.motion.elapsed*16)*2 : 0,
        drinking:w.phase === 'water' && !w.motion && w.pause > 1e-9,
        book:w.phase === 'stacks' || !!w.result,
        text:w.phase === 'water' && !w.motion ? 'Getting water'
          : w.result ? resultLabels[w.result.state] : w.motion ? 'Walking'
          : w.phase === 'rest' ? 'Resting' : null};
    }
    return poses;
  }
  return {observe, reset, step};
}

// Positions are the unchanged actor origin; collision uses only the feet.
// Every gap gets a door; 'swing' says which side its leaf opens into.
export const doors = [
  {id:'bridge-engram', x:256, y:104, w:12, h:44, swing:'right'},
  {id:'bridge', x:140, y:182, w:44, h:12, swing:'down'},
  {id:'engram', x:420, y:182, w:44, h:12, swing:'down'},
  {id:'workshop', x:180, y:232, w:44, h:10, swing:'down'},
  {id:'stacks', x:512, y:232, w:44, h:10, swing:'down'},
  {id:'workshop-stacks', x:456, y:300, w:12, h:44, swing:'right'},
  {id:'exit', x:276, y:408, w:56, h:12, swing:'up'},
];
// A door is open while a walker's feet are in or just beside its gap. The
// margin across a horizontal wall stays under the 12px lane offset, so walkers
// passing along the Workshop lane leave the door closed.
export function doorOpen(d, pose) {
  if (!pose?.away || !pose.position) return false;
  const fx = pose.position[0] + 16, fy = pose.position[1] + 67;
  const [mx, my] = d.swing==='right' ? [30, 8] : [8, 10];
  return fx >= d.x-mx && fx <= d.x+d.w+mx && fy >= d.y-my && fy <= d.y+d.h+my;
}
// 0 (closed) .. 1 (fully swung): the leaf opens over the first few pixels of
// the open zone, so it never pops. Zero exactly when doorOpen is false.
export function doorSwing(d, pose) {
  if (!doorOpen(d, pose)) return 0;
  const fx = pose.position[0] + 16, fy = pose.position[1] + 67;
  const [mx, my] = d.swing==='right' ? [30, 8] : [8, 10];
  const depth = d.swing==='right'
    ? Math.min(fx-(d.x-mx), d.x+d.w+mx-fx) : Math.min(fy-(d.y-my), d.y+d.h+my-fy);
  return Math.max(0, Math.min(1, (depth+1)/7));
}
export const feetBox = ([x,y]) => [x+8,y+64,16,6];
export const route = [[0,78,302],[1,78,302],[3,78,242],[6,186,242],[9,186,145],
  [22,518,145],[25,518,190]];
function travel(t) {
  for (let i=1;i<route.length;i++) {
    const [end,x,y]=route[i], [start,px,py]=route[i-1];
    if (t<=end) {
      const f=(t-start)/(end-start);
      return [Math.round(px+(x-px)*f),Math.round(py+(y-py)*f)];
    }
  }
  return route.at(-1).slice(1);
}
export function story(tick) {
  const away=tick>=12 && tick<=69;
  const position=away?travel(tick<38?tick-12:tick<44?25:69-tick):[78,302];
  const phase=tick<12?0:tick<38?1:tick<44?2:tick<70?3:4;
  const beats=['Plan the change; Writer starts coding.', 'Scout heads through the corridor to The Stacks.',
    'Scout picks a reference book; Verifier starts tests.', 'Scout brings three references back to the team.',
    'All tests green. The team needs your input.'];
  const texts={orchestrator:tick<12?'Planning':tick<70?'Assigning tasks':'Needs input ?',
    scout:tick<12?'Mapping files':tick<38?'To the stacks':tick<44?'Picking refs':'Found 3 refs',
    writer:'Writing code'+'.'.repeat(tick%3+1),
    verifier:tick<38?'Waiting':tick<70?'Running tests':'All green ✓'};
  const agents={};
  for (const d of desks) {
    const working=d.id==='writer'||d.id==='scout'&&!away||d.id==='verifier'&&tick>=38&&tick<70;
    const bob=working?tick%2:0;
    agents[d.id]={text:texts[d.id],working,hand:working?tick%2:0,bob,phase:tick,
      position:[d.x+38,d.y+8+bob],head:[d.x+54,d.y+4+bob],
      gesture:d.id==='orchestrator'&&tick>=12&&tick<30&&tick%4<2};
  }
  Object.assign(agents.scout,{away,position,book:tick>=40&&away,
    stride:away && tick>13 && tick<68 && !(tick>=37 && tick<=44)?[0,2,-2][tick%3]:0,
    head:away?[position[0]+16,position[1]-4]:agents.scout.head,
    feet:feetBox(position),
    bounds:away?[position[0]-4,position[1]-4,40,76]:[70,298,48,72]});
  return {tick,agents,caption:{name:'Office team',
    status:['Planning','Exploring','Reference found','Testing','Needs input'][phase],task:beats[phase]}};
}
