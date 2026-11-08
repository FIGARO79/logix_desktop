import React from 'react';
import { useParams } from 'react-router-dom';
import PackingListPrint from './PackingListPrint';

const ConsolidatedPackingList = () => {
    const { id } = useParams();
    return <PackingListPrint id={id} />;
};

export default ConsolidatedPackingList;
