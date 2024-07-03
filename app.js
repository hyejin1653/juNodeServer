var express = require('express');
var app = express();
var mysql = require('mysql');
var cors = require('cors');
const protobuf = require('protobufjs');
const pointInPolygon = require('point-in-polygon');
const geometry = require('node-geometry-library');

app.use(cors({
  origin: "*",
  header: "Access-Control-Allow-Origin : *"
}));


var connection  = mysql.createConnection({
    host: '118.38.20.105',
    port: 3306,
    user: 'root',
    password: 'gc8932', //gc8932 - 118서버
    database: 'vtslog'
  });

connection.connect(function(err){
if(err){
    console.error('mysql connection error');
    console.error(err);
    throw err;
}
});

//선종명 추출하기
let FN_shipTypeNm;
var sql = `  SELECT TYPE_CD, TYPE_NM, DESCRITION FROM ship_type_info `;
connection.query(sql, function(err, rows){
    if(err) throw err;
    FN_shipTypeNm = rows;
});
//선종명 KR추출
let FN_shipTypeName;
var sql = `  SELECT ROW_NUMBER() OVER(ORDER BY DESCRITION) AS ROWNUM, DESCRITION FROM ship_type_info group by DESCRITION  `;
connection.query(sql, function(err, rows){
    if(err) throw err;
    FN_shipTypeName = rows;
});

let FN_vesslName;
var sql = ` SELECT 	MMSI, 
                    MAX(VESSELNAME) AS VESSELNAME, 
                    MAX(SHIPTYPE) AS SHIPTYPE
            FROM vts_main
            GROUP BY MMSI `;
connection.query(sql, function(err, rows){
    if(err) throw err;
    FN_vesslName = rows;
});

function isInside(lot, let, data)
{
    //var data = JSON.parse(jogun);
    //console.log(data);
    var crosses = 0;
    for(var i = 0 ; i < data.length ; i++)
    {
        var j = (i+1)%data.length;
        //점 B가 선분 (p[i], p[j])의 y좌표 사이에 있음
        if((data[i][1] > let) != (data[j][1] > let) )
        {
            //atX는 점 B를 지나는 수평선과 선분 (p[i], p[j])의 교점
            var atX = (data[j][0] - data[i][0]) * (let - data[i][1]) / (data[j][1] - data[i][1]) + data[i][0];
            //atX가 오른쪽 반직선과의 교점이 맞으면 교점의 개수를 증가시킨다.
            if(lot < atX)
                crosses++;
        }
    }

    // for(var i = 0; i < rows.length; i++)
        // {
        //     var inPoint = isInside(rows[i].longitude, rows[i].latitude, data);
        //     //console.log(inPoint);
        //     if(inPoint == 'T')
        //     {
        //         resultData.push(rows[i]);
        //     }
        // }
    return (crosses % 2 > 0) ? 'T' : 'F';
}

//통계 결과(평균속도/침로)
app.get('/total/:fromDt/:endDt/:chk', function (req, res, next) {
    // var data = req.params.jogun;
    console.log('통계 결과(평균속도/침로)', new Date().toLocaleString() );
    const start = new Date();
    var sql = ` SELECT 	AVG(SOG) AS SOG,  
                        AVG(COG) AS COG, 
                        COUNT(*) AS CNT
                FROM vts_main A
                WHERE 1=1 
                AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}' `
                //최저값/최대값 제외 조건
                if(req.params.chk == 'T')
                {
                    sql +=  ` AND A.SOG != (SELECT MIN(SOG) 
                                                FROM vts_main 
                                                WHERE (SOG != 0))
                                AND A.SOG != (SELECT MAX(SOG) 
                                                FROM vts_main 
                                                WHERE (SOG != 0))
                                AND A.COG != (SELECT MIN(COG) 
                                                FROM vts_main 
                                                WHERE (COG != 0))
                                AND A.COG != (SELECT MAX(COG) 
                                                FROM vts_main 
                                                WHERE (COG != 0)) `
                }

                
    connection.query(sql, function(err, rows){
        if(err) throw err;
        var resultData = [];

        resultData.push(rows);
        //항적목록
        var sql2 = ` SELECT 	COG, AVG(SOG) AS SOG
                    FROM vts_main A
                    WHERE 1=1  
                    AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'`
                    //최저값/최대값 제외 조건
                    if(req.params.chk == 'T')
                    {
                        sql2 +=  ` AND A.SOG != (SELECT MIN(SOG) 
                                                    FROM vts_main 
                                                    WHERE (SOG != 0))
                                    AND A.SOG != (SELECT MAX(SOG) 
                                                    FROM vts_main 
                                                    WHERE (SOG != 0))
                                    AND A.COG != (SELECT MIN(COG) 
                                                    FROM vts_main 
                                                    WHERE (COG != 0))
                                    AND A.COG != (SELECT MAX(COG) 
                                                    FROM vts_main 
                                                    WHERE (COG != 0)) `
                    }
                    sql2 += `    GROUP BY COG  `
        
        connection.query(sql2, function(err, rows){
        if(err) throw err;
            resultData.push(rows);


            protobuf.load("backend.proto", function(err, root){
                if(err) throw err;
    
                let inOutMessage = root.lookupType("TotalData");
    
                var resultObj = new Object();
                resultObj['TotalHResult'] = resultData[0];
                resultObj['TotalDResult'] = resultData[1];
                let payload = resultObj;
    
                let errMsg = inOutMessage.verify(payload);
                if(errMsg) throw Error(errMsg);
    
                var buffer = inOutMessage.encode(payload).finish();
                res.send(buffer);
            })
            console.log('전송완료!', resultData[0].length, resultData[1].length, ((new Date() - start) / 1000) );
            //res.send(resultData);
        });
    });
});

//통계 결과(정박시간)
app.get('/stayList/:fromDt/:endDt', function (req, res, next) {
    console.log('통계 결과(정박시간)', new Date().toLocaleString() );
    const start = new Date();
    var sql = `  SELECT 	A.MMSI,
                            DATE_FORMAT( MIN(A.INSERT_DT), '%Y-%m-%d %H:%i:%s' ) AS START_DT, 
                            DATE_FORMAT( MAX(A.INSERT_DT), '%Y-%m-%d %H:%i:%s' ) AS END_DT, 
                            DATE_FORMAT( TIMEDIFF(MAX(A.INSERT_DT), MIN(A.INSERT_DT)), '%Y-%m-%d %H:%i:%s' ) AS STAY_DT
                FROM vts_main A
                JOIN CLASS_INFO C ON A.MESSAGETYPE = C.CLASS_CD
                WHERE 1=1
                AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'
                GROUP BY A.MMSI `;
    connection.query(sql, function(err, rows){
        if(err) throw err;

        for(let data of rows)
        {
            let vesselNMObj = {};
            let vesselName = FN_vesslName.find(v=> v.MMSI === data.MMSI)
           
            vesselNMObj.VESSELNAME = vesselName.VESSELNAME;
            Object.assign(data, vesselNMObj);
        }

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("StayData");

            var resultObj = new Object();
            resultObj['StayResult'] = rows;
            let payload = resultObj;

            //console.log(payload);

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            //console.log(buffer);
            res.send(buffer);
        })
        console.log('전송완료!', rows.length, ((new Date() - start) / 1000) );
        //res.send(rows);
    });
});

//좌표 사이의 거리 구하기
function getDistance( dataF, dataT ){
    var lat1 = parseFloat(dataF[1]);
    var lng1 = parseFloat(dataF[0]);
    var lat2 = parseFloat(dataT[1]);
    var lng2 = parseFloat(dataT[0]);
    
    function deg2rad(deg) {
        return deg * (Math.PI/180)
    }

    var r = 6371; //지구의 반지름(km)
    var dLat = deg2rad(lat2-lat1);
    var dLon = deg2rad(lng2-lng1);
    var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon/2) * Math.sin(dLon/2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    var d = r * c; // Distance in km

    return (d * 1000);

    // var dis_x = dataF[0] - dataT[0];
    // var dix_y = dataF[1] - dataT[1];

    // dist = Math.sqrt( Math.pow(Math.abs( dis_x * dis_x ), 2) + Math.pow(Math.abs( dix_y * dix_y ), 2) );
    // return dist;
}

function getDataArr(data) {
    var dataArr = [];
    for(var r = 0; r < data.length; r++)
    {
        let lng = parseFloat(data[r][0]);
        let lat = parseFloat(data[r][1]);
        dataArr.push({lat, lng});
    }

	return dataArr;
}

//그룹짓기
const groupBy = function (data, key) {
    return data.reduce(function (carry, el) {
        var group = el[key];

        if (carry[group] === undefined) {
            carry[group] = []
        }

        carry[group].push(el)
        return carry
    }, {})
}

//구역 선박목록
app.get('/aroundAllList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('구역all 선박목록', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    //console.log(req.params.sector);
    var resultData = [];
    var sql = ` SELECT 	A.MMSI, A.LONGITUDE, A.LATITUDE
                FROM vts_main A
                WHERE 1=1
                AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'
                ORDER BY A.INSERT_DT `;

    connection.query(sql, function(err, rows){
        if(err) throw err;
        //console.log(rows.length);
        //let one = getDistance(data[0], data[1]);
        let rowR = {};
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);
            
            for(let i in rows)
            {
                rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2) //원일때
                {
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);

                    if(pointRow[1] >= parseFloat(inPoint))
                    {
                        rowR.AREA_NM = areaNm;
                        resultData.push(rowR);
                    }
                }else{
                    let lng = rowR.LONGITUDE;
                    let lat = rowR.LATITUDE;

                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        rowR.AREA_NM = areaNm;
                        resultData.push(rowR);
                    }
                }
            }
            //console.log(resultData.length, areaNm);
        }

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("AroundAllData");

            var resultObj = new Object();
            resultObj['AroundAllResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })

        console.log('전송완료!', resultData.length, ((new Date() - start) / 1000) );
        //res.send(resultData);
    });
});



//구역 선박목록
app.get('/aroundList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('구역 선박목록', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    var resultData = [];
    var sql = ` SELECT 	DATE_FORMAT(A.INSERT_DT, '%Y-%m-%d %H:%i:%s') AS INSERT_DT, A.MMSI, 
                        A.MESSAGETYPE, C.CLASS_NM AS MSG_NM, 'False' AS FLG, A.LONGITUDE, A.LATITUDE
                FROM vts_main A
                JOIN CLASS_INFO C ON A.MESSAGETYPE = C.CLASS_CD
                WHERE 1=1
                AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'  `;

    connection.query(sql, function(err, rows){
        if(err) throw err;
        //console.log(rows.length);
        //let one = getDistance(data[0], data[1]);
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i in rows)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2) //원일때
                {
                    let jogun = [rowR.LONGITUDE, rowR.LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);
    
                    if(pointRow[1] >= parseFloat(inPoint))
                    {
                        rowR.AREA_NM = areaNm;
                        resultData.push(rowR);
                    }
                }else{
                    let lng = rowR.LONGITUDE;
                    let lat = rowR.LATITUDE;

                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        rowR.AREA_NM = areaNm;
                        resultData.push(rowR);
                    }
                }
            }
        }


        let area = groupBy(resultData, 'AREA_NM'); //구역마다
        var resultArr = [];
        for(let valueArea of Object.values(area))
        {
            /** 선박 하나당 하나만 뽑기위해 추가 22.03.10 */
            let arrMMSI = groupBy(valueArea, 'MMSI'); 
            for(let resultObject of Object.values(arrMMSI))
            {
                //선박명
                let vesselName = FN_vesslName.find(v=> v.MMSI === resultObject[0].MMSI);
                
                //선종명
                let shipType = FN_shipTypeNm.find(v=> v.TYPE_CD === vesselName.SHIPTYPE);
                if(shipType == "" || shipType == undefined)
                {
                    shipType = "Not available (default)";
                }else{
                    shipType = shipType.TYPE_NM;
                }

                var resultObj = new Object();
                resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                resultObj['MMSI'] = resultObject[0].MMSI;
                resultObj['VESSELNAME'] = vesselName.VESSELNAME;
                resultObj['SHIPTYPENM'] = shipType;
                resultObj['MSG_NM'] = resultObject[0].MSG_NM;
                resultObj['FLG'] = resultObject[0].FLG;
                resultArr.push(resultObj);
            } 
        }

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("AroundData");

            var resultObj = new Object();
            resultObj['AroundResult'] = resultArr;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })
        //console.log(pointArr);
        console.log('전송완료!', resultArr.length, ((new Date() - start) / 1000)  );
        //res.send(resultData);
    });
});



//구역 선종별목록
app.get('/aroundShipTypeList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('구역 선종별목록', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    var sql = ` SELECT DATE_FORMAT(A.INSERT_DT, "%Y-%m") AS YYMM, A.MMSI, A.LONGITUDE, A.LATITUDE
                FROM vts_main A
                WHERE 1=1
                AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'  `;
    connection.query(sql, function(err, rows){
        if(err) throw err;
        var resultData = [];
        var sectorData = []; //구역정보 
        
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i = 0; i < rows.length; i++)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2) //원일때
                {
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);
    
                    if(pointRow[1] >= parseFloat(inPoint))
                    {
                        rowR.AREA_NM = areaNm;
                        sectorData.push(rowR);
                    }
                }else{
                    let lng = parseFloat(rows[i].LONGITUDE);
                    let lat = parseFloat(rows[i].LATITUDE);

                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        rowR.AREA_NM = areaNm;
                        sectorData.push(rowR);
                    }
                }
            }
        }

        let area = groupBy(sectorData, 'AREA_NM'); //구역마다
        for(let valueArea of Object.values(area))
        {
            let arrYYMM = groupBy(valueArea, 'YYMM'); //달마다
            for(let valueYYmm of Object.values(arrYYMM))
            {
                var mmsiRlt = [];
                let mmsi = groupBy(valueYYmm, 'MMSI'); 
                for(let mmsiArr of Object.values(mmsi))
                {
                    //선박명
                    let vesselName = FN_vesslName.find(v=> v.MMSI === mmsiArr[0].MMSI);
                    
                    let veslObj = {};
                    //선종명
                    let shipType = FN_shipTypeNm.find(v=> v.TYPE_CD === vesselName.SHIPTYPE);
                    if(shipType == "" || shipType == undefined)
                    {
                        veslObj.SHIPTYPENM = "없음";
                    }else{
                        veslObj.SHIPTYPENM = shipType.DESCRITION;
                    }
                    

                    Object.assign(mmsiArr[0], veslObj);
                    mmsiRlt.push(mmsiArr[0]);
                }

                let shipType = groupBy(mmsiRlt, 'SHIPTYPENM'); 
                let totSum = 0;
                var resultObj = new Object();
                resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                resultObj['YYMM'] = valueYYmm[0].YYMM;
                for(let shipArr of Object.values(shipType))
                {
                    let shipType = FN_shipTypeName.find(v=> v.DESCRITION === shipArr[0].SHIPTYPENM);
                    let rowCnt;
                    if(shipType == "" || shipType == undefined)
                    {
                        rowCnt = "25";
                    }else{
                        rowCnt = shipType.ROWNUM.toString();
                        rowCnt = (rowCnt.length == 1) ? "0" + rowCnt : rowCnt;
                    }

                    let shipDecObj = {};
                    shipDecObj['H'+rowCnt] = shipArr.length;
                    Object.assign(resultObj, shipDecObj);
                    
                    totSum += shipArr.length;
                    // let result = shipArr.filter(x => {
                    //     return  x.SHIPTYPE == shipArr[0].SHIPTYPE
                    // });

                    // if(shipType == "" || shipType == undefined)
                    // {
                    //     shipType = "없음";
                    // }else{
                    //     shipType = shipType.DESCRITION;
                    // }

                    // let shipObj = new Object();
                    // shipObj['DESCRITION'] = shipType;
                    // shipObj['DESCRITION_CNT'] = result.length;
                    // shipR.push(shipObj);
                }

                resultObj['TOT_SUM'] =  totSum;
                resultData.push(resultObj);
            }
        }
        
        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("AroundShipTypeData");

            var resultObj = new Object();
            resultObj['AroundShipTypeResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })

        console.log('전송완료!', resultData.length, ((new Date() - start) / 1000)  );
        //console.log(resultData);
        //res.send(resultData);
    });
});

//구역 시간대별
app.get('/aroundTimeList/:sector/:fromDt/:endDt', function (req, res, next) {
    //console.log(req.params.sector);
    console.log('구역 시간대별', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    var resultData = [];
    var sql = ` SELECT 	A.MMSI, A.LONGITUDE, A.LATITUDE, 
                    DATE_FORMAT(A.INSERT_DT, "%Y-%m-%d") AS INSERT_DT, DATE_FORMAT(A.INSERT_DT, "%H") AS HOR
                FROM vts_main A
                WHERE A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'  `;
    connection.query(sql, function(err, rows){
        if(err) throw err;
        //console.log(rows.length);
        var sectorData = [];
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i = 0; i < rows.length; i++)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2) //원일때
                {
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);
    
                    if(pointRow[1] >= parseFloat(inPoint))
                    {
                        rowR.AREA_NM = areaNm;
                        sectorData.push(rowR);
                    }
                }else{
                    let lng = parseFloat(rows[i].LONGITUDE);
                    let lat = parseFloat(rows[i].LATITUDE);

                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        rowR.AREA_NM = areaNm;
                        sectorData.push(rowR);
                    }
                }
            }
        }

        let area = groupBy(sectorData, 'AREA_NM'); //구역마다
        for(let valueArea of Object.values(area))
        {
            //일자마다 묶어야 하므로
            let arrYYMMDD = groupBy(valueArea, 'INSERT_DT'); 
            for(let resultArr of Object.values(arrYYMMDD))
            {
                var resultObj = new Object();
                resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                resultObj['INSERT_DT'] = resultArr[0].INSERT_DT;

                //시간마다
                let arrHOR = groupBy(resultArr, 'HOR'); 
                let sumHor = 0;
                for(let hourArr of Object.values(arrHOR))
                {
                    let hourObj = {};
                    hourObj['H' + hourArr[0].HOR] = hourArr.length;
                    sumHor += hourArr.length;
                    Object.assign(resultObj, hourObj);
                    //console.log(resultArr[0].INSERT_DT, hourArr[0].HOR, hourArr.length);
                }
                resultObj['TOT_SUM'] = sumHor;
                //console.log(resultObj);
                resultData.push(resultObj);
            }
        }
        
        //console.log(resultData);

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("AroundTimeData");

            var resultObj = new Object();
            resultObj['AroundTimeResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })
        console.log('전송완료!', resultData.length,  ((new Date() - start) / 1000) );
        //res.send(resultData);
    });
});

//구역 클래스 타입별
app.get('/aroundClassList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('구역 클래스 타입별', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    let dataArr = getDataArr(data);
    var resultData = [];
    var sql = ` SELECT 	A.MMSI, A.LONGITUDE, A.LATITUDE, A.MESSAGETYPE, 
                        DATE_FORMAT(A.INSERT_DT, '%Y') AS YY, B.CLASS_NM
                FROM vts_main A
                JOIN class_info B ON A.MESSAGETYPE = B.CLASS_CD
                WHERE A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'	 `;
    connection.query(sql, function(err, rows){
        if(err) throw err;

        var sectorData = [];
        
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i = 0; i < rows.length; i++)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2) //원일때
                {
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);
    
                    if(pointRow[1] >= parseFloat(inPoint))
                    {
                        rowR.AREA_NM = areaNm;   
                        sectorData.push(rowR);
                    }
                }else{
                    let lng = parseFloat(rows[i].LONGITUDE);
                    let lat = parseFloat(rows[i].LATITUDE);

                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        rowR.AREA_NM = areaNm;   
                        sectorData.push(rowR);
                    }
                }
            }
        }

        let area = groupBy(sectorData, 'AREA_NM'); //구역마다
        for(let valueArea of Object.values(area))
        {
            //일자마다 묶어야 하므로
            let arrYY = groupBy(valueArea, 'YY'); 
            for(let yearArr of Object.values(arrYY))
            {
                let classArr = groupBy(yearArr, 'CLASS_NM'); 
                for(let resultArr of Object.values(classArr))
                {
                    let result = resultArr.filter(x => {
                        return  x.CLASS_NM == resultArr[0].CLASS_NM
                    });
                    var resultObj = new Object();
                    resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                    resultObj['YY'] = yearArr[0].YY;
                    resultObj['CLASS_NM'] = resultArr[0].CLASS_NM;
                    resultObj['CLASS_CNT'] = result.length;
                    resultData.push(resultObj);
                }
            }
        }

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("AroundClassData");

            var resultObj = new Object();
            resultObj['AroundClassResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })

        //console.log(resultData);
        console.log('전송완료!', resultData.length,  ((new Date() - start) / 1000) );
        //res.send(resultData);
    });
});

//진입/이탈 선박목록
app.get('/inoutList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('진입/이탈 선박목록', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    let resultData = [];
    var sql = ` SELECT 	DATE_FORMAT(A.INSERT_DT, '%Y-%m-%d %H:%i:%S') AS INSERT_DT, A.MMSI, 
                        A.MESSAGETYPE, C.CLASS_NM AS MSG_NM, 'False' AS FLG, A.LONGITUDE, A.LATITUDE
                FROM vts_main A
                JOIN CLASS_INFO C ON A.MESSAGETYPE = C.CLASS_CD
                WHERE 1=1
                AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}' `;
    connection.query(sql, function(err, rows){
        if(err) throw err;

        var resultTitle = [];
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i = 0; i < rows.length; i++)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2)
                {
                    //원일때 해당 조건
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);

                    if(parseFloat(pointRow[1]) >= parseFloat(inPoint))
                    {
                        if((parseFloat(pointRow[1]) - 10) <= parseFloat(inPoint) && parseFloat(inPoint) <= parseFloat(pointRow[1]))
                        {
                            rowR.AREA_NM = areaNm;   
                            resultTitle.push(rowR);
                        }
                    }
                }else{
                    //원이 아닐때 해당 조건(폴리곤, 사각형)
                    let lng = parseFloat(rows[i].LONGITUDE);
                    let lat = parseFloat(rows[i].LATITUDE);

                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr);
                    if(result)
                    {
                        //구역의 라인에 걸리는 좌표만 추출한다.
                        let lineRelt = geometry.PolyUtil.isLocationOnPath({lat, lng}, dataArr, 10);
                        if(lineRelt)
                        {
                            rowR.AREA_NM = areaNm;   
                            resultTitle.push(rowR);
                        }
                    }
                }
            }
        }

        let area = groupBy(resultTitle, 'AREA_NM'); //구역마다
        for(let valueArea of Object.values(area))
        {
            let mmsiArr = groupBy(valueArea, 'MMSI'); 
            //var resultArr = [];
            for(let mmsiResult of Object.values(mmsiArr))
            {
                let dtArr = [];
                var resultArr = [];
                for(let item in mmsiResult)
                {
                    if(item > 0)
                    {
                        var latDt = new Date(mmsiResult[item - 1].INSERT_DT);
                        var nowDt = new Date(mmsiResult[item].INSERT_DT);

                        let timD = nowDt.getTime() - latDt.getTime();

                        if((timD / 1000 / 60) < 1)
                        {   
                            mmsiResult.splice(item, 1);
                            continue;
                        }
                    }

                    let dt = new Date(mmsiResult[item].INSERT_DT);
                    resultArr.push(mmsiResult[item]);
                    dtArr.push(dt);
                }

                var minDt = new Date(Math.min(...dtArr) + 3240 * 10000).toISOString().replace("T", " ").replace(/\..*/, '');
                var maxDt = new Date(Math.max(...dtArr) + 3240 * 10000).toISOString().replace("T", " ").replace(/\..*/, '');

                var dtMin = new Date(minDt);
                var dtMax = new Date(maxDt);
                let timeDiff = dtMax.getTime() - dtMin.getTime();
                
                //console.log(mmsi, dtMin, dtMax, timeDiff / 1000 / 60);

                //console.log(valueArea[0].AREA_NM, resultArr.length);

                for(let row of resultArr)
                {
                    //선박명
                    let vesselName = FN_vesslName.find(v=> v.MMSI === row.MMSI);
                    
                    //선종명
                    let shipType = FN_shipTypeNm.find(v=> v.TYPE_CD === vesselName.SHIPTYPE);
                    if(shipType == "" || shipType == undefined)
                    {
                        shipType = "Not available (default)";
                    }else{
                        shipType = shipType.TYPE_NM;
                    }

                    var minObj = new Object();
                    minObj['AREA_NM'] = valueArea[0].AREA_NM;
                    minObj['MMSI'] = row.MMSI;
                    minObj['VESSELNAME'] = vesselName.VESSELNAME;
                    minObj['IO_TYPE'] = '진입';
                    if((timeDiff / 1000 / 60) > 1)
                    {
                        if(row.INSERT_DT == maxDt)
                        {
                            minObj['IO_TYPE'] = '이탈'
                        }
                    }
                    minObj['INSERT_DT'] = row.INSERT_DT;
                    minObj['SHIPTYPENM'] = shipType;
                    minObj['MSG_NM'] = row.MSG_NM;
                    minObj['FLG'] = row.FLG;
                    resultData.push(minObj);
                }
            }
        }


        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("InoutAvgData");

            var resultObj = new Object();
            resultObj['InoutResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })
        console.log('전송완료!', resultData.length,  ((new Date() - start) / 1000));
        //res.send(resultArr);
    });
});

//진입/이탈 선종별
app.get('/inoutShipTypeList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('진입/이탈 선종별', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    var resultData = [];
    var sql = ` SELECT DATE_FORMAT(A.INSERT_DT, "%Y-%m") AS YYMM, A.MMSI, A.LONGITUDE, A.LATITUDE
                FROM vts_main A
                WHERE 1=1
                AND A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}' `
    connection.query(sql, function(err, rows){
        if(err) throw err;

        var sectorData = []; //구역정보 
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i = 0; i < rows.length; i++)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2)
                {
                    //원일때 해당 조건
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);

                    if(parseFloat(pointRow[1]) >= parseFloat(inPoint))
                    {
                        if((parseFloat(pointRow[1]) - 10) <= parseFloat(inPoint) && parseFloat(inPoint) <= parseFloat(pointRow[1]))
                        {
                            rowR.AREA_NM = areaNm;   
                            sectorData.push(rowR);
                        }
                    }
                }else{
                    //원이 아닐때 해당 조건(폴리곤, 사각형)
                    let lng = rowR.LONGITUDE;
                    let lat = rowR.LATITUDE;
                    
                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        //구역의 라인에 걸리는 좌표만 추출한다.
                        let lineRelt = geometry.PolyUtil.isLocationOnPath({lat, lng}, dataArr, 10);
                        if(lineRelt)
                        {
                            rowR.AREA_NM = areaNm;   
                            sectorData.push(rowR);
                        }
                    }
                }
            }
        }
        
        
        let area = groupBy(sectorData, 'AREA_NM'); //구역마다
        for(let valueArea of Object.values(area))
        {
            let arrYYMM = groupBy(valueArea, 'YYMM'); //달마다
            for(let valueYYmm of Object.values(arrYYMM))
            {
                //한 선박에 여러 항적이 있으므로 선박 리스트업
                var mmsiRlt = [];
                let mmsi = groupBy(valueYYmm, 'MMSI'); 
                for(let mmsiArr of Object.values(mmsi))
                {
                    //선박명
                    let vesselName = FN_vesslName.find(v=> v.MMSI === mmsiArr[0].MMSI);
                    
                    let veslObj = {};
                    //선종명
                    let shipType = FN_shipTypeNm.find(v=> v.TYPE_CD === vesselName.SHIPTYPE);
                    if(shipType == "" || shipType == undefined)
                    {
                        veslObj.SHIPTYPENM = "없음";
                    }else{
                        veslObj.SHIPTYPENM = shipType.DESCRITION;
                    }

                    Object.assign(mmsiArr[0], veslObj);
                    mmsiRlt.push(mmsiArr[0]);
                }

                let shipType = groupBy(mmsiRlt, 'SHIPTYPENM'); 
                let totSum = 0;
                var resultObj = new Object();
                resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                resultObj['YYMM'] = valueYYmm[0].YYMM;
                for(let shipArr of Object.values(shipType))
                {
                    let shipType = FN_shipTypeName.find(v=> v.DESCRITION === shipArr[0].SHIPTYPENM);
                    let rowCnt;
                    if(shipType == "" || shipType == undefined)
                    {
                        rowCnt = "25";
                    }else{
                        rowCnt = shipType.ROWNUM.toString();
                        rowCnt = (rowCnt.length == 1) ? "0" + rowCnt : rowCnt;
                    }

                    let shipDecObj = {};

                    shipDecObj['H'+rowCnt] = shipArr.length;
                    Object.assign(resultObj, shipDecObj);

                    totSum += shipArr.length;
                    // let result = shipArr.filter(x => {
                    //     return  x.SHIPTYPE == shipArr[0].SHIPTYPE
                    // });

                    // if(shipType == "" || shipType == undefined)
                    // {
                    //     shipType = "없음";
                    // }else{
                    //     shipType = shipType.DESCRITION;
                    // }

                    // let shipObj = new Object();
                    // shipObj['DESCRITION'] = shipType;
                    // shipObj['DESCRITION_CNT'] = result.length;
                    // shipR.push(shipObj);
                }

                resultObj['TOT_SUM'] =  totSum;
                resultData.push(resultObj);

                // var resultObj = new Object();
                // resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                // resultObj['YYMM'] = valueYYmm[0].YYMM;

                // let desc = groupBy(shipR, 'DESCRITION'); 
                // let totSum = 0;
                // for(let descArr of Object.values(desc))
                // {
                //     let cnt = 1;
                //     for(let tit of FN_shipTypeName)
                //     {
                //         let Tcnt = cnt.toString();
                //         Tcnt = (Tcnt.length == 1) ? "0" + Tcnt : Tcnt;

                //         if(tit.DESCRITION == descArr[0].DESCRITION)
                //         {
                //             resultObj['H' + Tcnt] = descArr.length;
                //             totSum += descArr.length;
                //         }
                //         cnt++;
                //     }
                // }
                // resultObj['TOT_SUM'] =  totSum;
                // resultData.push(resultObj);
            }
        }

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("InoutShipTypeData");

            var resultObj = new Object();
            resultObj['InoutShipTypeResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })
        console.log('전송완료!', resultData.length, ((new Date() - start) / 1000));

        //console.log(resultData);
        //res.send(resultData);
    });
});

//진입/이탈 시간대별
app.get('/inoutTimeList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('진입/이탈 시간대별', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    var resultData = [];
    var sql = ` SELECT 	A.MMSI, A.LONGITUDE, A.LATITUDE, DATE_FORMAT(A.INSERT_DT, '%Y-%m-%d %H:%i:%S') AS BASE_DT,
                        DATE_FORMAT(A.INSERT_DT, "%Y-%m-%d") AS INSERT_DT, DATE_FORMAT(A.INSERT_DT, "%H") AS HOR
                FROM vts_main A
                WHERE A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'  `;
    connection.query(sql, function(err, rows){
        if(err) throw err;
        //console.log(rows.length);
        var sectorData = [];
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i = 0; i < rows.length; i++)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2)
                {
                    //원일때 해당 조건
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);

                    if(parseFloat(pointRow[1]) >= parseFloat(inPoint))
                    {
                        if((parseFloat(pointRow[1]) - 10) <= parseFloat(inPoint) && parseFloat(inPoint) <= parseFloat(pointRow[1]))
                        {
                            rowR.AREA_NM = areaNm;   
                            sectorData.push(rowR);
                        }
                    }
                }else{
                    //원이 아닐때 해당 조건(폴리곤, 사각형)
                    let lng = parseFloat(rows[i].LONGITUDE);
                    let lat = parseFloat(rows[i].LATITUDE);
                    
                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        //구역의 라인에 걸리는 좌표만 추출한다.
                        let lineRelt = geometry.PolyUtil.isLocationOnPath({lat, lng}, dataArr, 10);
                        if(lineRelt)
                        {
                            rowR.AREA_NM = areaNm;
                            sectorData.push(rowR);
                        }
                    }
                }
            }
        }

        let mmsiArr = groupBy(sectorData, 'MMSI'); 
        var inoutArr = [];
        for(let mmsiResult of Object.values(mmsiArr))
        {
            for(let item in mmsiResult)
            {
                if(item > 0)
                {
                    var latDt = new Date(mmsiResult[item - 1].BASE_DT);
                    var nowDt = new Date(mmsiResult[item].BASE_DT);

                    let timD = nowDt.getTime() - latDt.getTime();

                    if((timD / 1000 / 60) < 1)
                    {   
                        mmsiResult.splice(item, 1);
                        continue;
                    }
                }
                inoutArr.push(mmsiResult[item]);
            }
        }

        let area = groupBy(inoutArr, 'AREA_NM'); //구역마다
        for(let valueArea of Object.values(area))
        {
            //일자마다 묶어야 하므로
            let arrYYMMDD = groupBy(valueArea, 'INSERT_DT'); 
            for(let resultArr of Object.values(arrYYMMDD))
            {
                var resultObj = new Object();
                resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                resultObj['INSERT_DT'] = resultArr[0].INSERT_DT;

                //시간마다
                let arrHOR = groupBy(resultArr, 'HOR'); 
                let sumHor = 0;
                for(let hourArr of Object.values(arrHOR))
                {
                    let hourObj = {};
                    hourObj['H' + hourArr[0].HOR] = hourArr.length;
                    sumHor += hourArr.length;
                    Object.assign(resultObj, hourObj);
                    //console.log(resultArr[0].INSERT_DT, hourArr[0].HOR, hourArr.length);
                }
                resultObj['TOT_SUM'] = sumHor;
                //console.log(resultObj);
                resultData.push(resultObj);
            }
        }
        //console.log(resultData);

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("InoutTimeData");

            var resultObj = new Object();
            resultObj['InoutTimeResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })
        console.log('전송완료!', resultData.length, ((new Date() - start) / 1000));
        //res.send(resultData);
    });
})

//진입/이탈 클래스 타입별
app.get('/inoutClassList/:sector/:fromDt/:endDt', function (req, res, next) {
    console.log('진입/이탈 클래스 타입별', new Date().toLocaleString() );
    const start = new Date();
    let data = JSON.parse(req.params.sector);
    var resultData = [];
    var sql = ` SELECT 	A.MMSI, A.LONGITUDE, A.LATITUDE, A.MESSAGETYPE, DATE_FORMAT(A.INSERT_DT, '%Y') AS YY, 
                        B.CLASS_NM, DATE_FORMAT(A.INSERT_DT, '%Y-%m-%d %H:%i:%S') AS BASE_DT
                FROM vts_main A
                JOIN class_info B ON A.MESSAGETYPE = B.CLASS_CD
                WHERE A.INSERT_DT BETWEEN '${req.params.fromDt}' AND '${req.params.endDt}'	 `;
    connection.query(sql, function(err, rows){
        var sectorData = [];
        for(let row in data)
        {
            let areaNm = data[row][0];
            let pointRow = data[row][1];
            var dataArr = getDataArr(pointRow);

            for(var i = 0; i < rows.length; i++)
            {
                let rowR = {};
                Object.assign(rowR, rows[i]);

                if(pointRow.length == 2)
                {
                    //원일때 해당 조건
                    let jogun = [rows[i].LONGITUDE, rows[i].LATITUDE];
                    var inPoint = getDistance(pointRow[0], jogun);

                    if(parseFloat(pointRow[1]) >= parseFloat(inPoint))
                    {
                        if((parseFloat(pointRow[1]) - 10) <= parseFloat(inPoint) && parseFloat(inPoint) <= parseFloat(pointRow[1]))
                        {
                            rowR.AREA_NM = areaNm;   
                            sectorData.push(rowR);
                        }
                    }
                }else{
                    //원이 아닐때 해당 조건(폴리곤, 사각형)
                    let lng = parseFloat(rows[i].LONGITUDE);
                    let lat = parseFloat(rows[i].LATITUDE);
                    
                    let result = geometry.PolyUtil.containsLocation({lat, lng}, dataArr)
                    if(result)
                    {
                        //구역의 라인에 걸리는 좌표만 추출한다.
                        let lineRelt = geometry.PolyUtil.isLocationOnPath({lat, lng}, dataArr, 10);
                        if(lineRelt)
                        {
                            rowR.AREA_NM = areaNm;
                            sectorData.push(rowR);
                        }
                    }
                }
            }
        }

        let mmsiArr = groupBy(sectorData, 'MMSI'); 
        var inoutArr = [];
        for(let mmsiResult of Object.values(mmsiArr))
        {
            for(let item in mmsiResult)
            {
                if(item > 0)
                {
                    var latDt = new Date(mmsiResult[item - 1].BASE_DT);
                    var nowDt = new Date(mmsiResult[item].BASE_DT);

                    let timD = nowDt.getTime() - latDt.getTime();

                    if((timD / 1000 / 60) < 1)
                    {   
                        mmsiResult.splice(item, 1);
                        continue;
                    }
                }
                inoutArr.push(mmsiResult[item]);
            }
        }


        let area = groupBy(inoutArr, 'AREA_NM'); //구역마다
        for(let valueArea of Object.values(area))
        {
            //일자마다 묶어야 하므로
            let arrYY = groupBy(valueArea, 'YY'); 
            for(let yearArr of Object.values(arrYY))
            {
                let classArr = groupBy(yearArr, 'CLASS_NM'); 
                for(let resultArr of Object.values(classArr))
                {
                    let result = resultArr.filter(x => {
                        return  x.CLASS_NM == resultArr[0].CLASS_NM 
                    });
                    var resultObj = new Object();
                    resultObj['AREA_NM'] = valueArea[0].AREA_NM;
                    resultObj['YY'] = yearArr[0].YY;
                    resultObj['CLASS_NM'] = resultArr[0].CLASS_NM;
                    resultObj['CLASS_CNT'] = result.length;
                    resultData.push(resultObj);
                }
            }
        }

        protobuf.load("backend.proto", function(err, root){
            if(err) throw err;

            let inOutMessage = root.lookupType("InoutClassData");

            var resultObj = new Object();
            resultObj['InoutClassResult'] = resultData;
            let payload = resultObj;

            let errMsg = inOutMessage.verify(payload);
            if(errMsg) throw Error(errMsg);

            var buffer = inOutMessage.encode(payload).finish();
            res.send(buffer);
        })
        console.log('전송완료!', resultData.length, ((new Date() - start) / 1000));
        //res.send(resultData);
    });
})

const port = 3600
app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
})