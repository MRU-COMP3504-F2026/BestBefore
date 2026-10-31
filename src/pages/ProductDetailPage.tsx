import { useEffect, useState } from "react";
import { useNavigate, useParams } from 'react-router-dom';
import InventoryList from "../components/InventoryList";
import '../styles/ProductDetailPage.css'
import { fetchInventory, type InventoryItem } from "../lib/inventoryApi"


export default function ProductDetailPage() {

    
    const { id } = useParams();
    const [product, setProduct] = useState<InventoryItem | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchProduct = async () => {
            try {
                setLoading(true);
                setError(null);

                const items = await fetchInventory(); 
                const item = items.find((i) => i.id === Number(id));

                if (!item) {
                    throw new Error('Product not found');
            }

            setProduct(item);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Something went wrong');
                setProduct(null);
            } finally {
                setLoading(false);
            }
        };

        if (id) {
            fetchProduct();
        }
        }, [id]);

    return (

        <div className="product-detail">
            

            <h1>{product?.name ?? 'Unnamed Product'}</h1>

            <div className="info-list">
                <div className="info-row">
                <span className="label">Brand</span>
                <input
                    className="value-input"
                    value={product?.brand ?? ''}
                    onChange={() => {}}
                />
            </div>

             <div className="info-row">
                <span className="label">Barcode</span>
                <input
                    className="value-input"
                    value={product?.barcode ?? ''}
                    onChange={() => {}}
                />
            </div>

            <div className="info-row">
                <span className="label">Category</span>
                <input
                    className="value-input"
                    value={product?.category ?? ''}
                    onChange={() => {}}
                />
            </div>

            <div className="info-row">
                <span className="label">Quantity</span>
                <input
                    className="value-input"
                    type="number"
                    value={product?.quantity ?? ''}
                    onChange={() => {}}
                />
            </div>

            <div className="info-row">
                <span className="label">Unit</span>
                <input
                    className="value-input"
                    value={product?.unit ?? ''}
                    onChange={() => {}}
                />
            </div>

            <div className="info-row">
                <span className="label">Purchase Date</span>
                <input
                    className="value-input"
                    type="date"
                    value={product?.purchaseDate ?? ''}
                    onChange={() => {}}
                />
            </div>

            <div className="info-row">
                <span className="label">Best Before</span>
                <input
                    className="value-input"
                    type="date"
                    value={product?.bestBefore ?? ''}
                    onChange={() => {}}
                />
                </div>
            </div>

            <button className="back-button" onClick={() => navigate(-1)}>
                <span className="arrow">‹</span>
                Back
            </button>
        </div>
    );
}